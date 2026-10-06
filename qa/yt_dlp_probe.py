"""One bounded, authorized yt-dlp feasibility probe; not a production backend."""
import io
import json
import re
import signal
import subprocess
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
import yt_dlp
from yt_dlp.networking import Response
from yt_dlp.networking.exceptions import HTTPError as YtdlpHTTPError

VIDEO_ID = "mVTlbvQ_010"
LIST_URL = "https://raw.githubusercontent.com/yt2178/kids-youtube/main/videos.txt"
OUTPUT = Path("qa/yt-dlp-proof.json")
MAX_BYTES = 2 * 1024 * 1024
REPORT = {
    "tool": "yt-dlp", "version": yt_dlp.version.__version__,
    "videoId": VIDEO_ID, "environment": "GitHub Actions Linux (cloud network)",
    "whitelistVerified": False, "metadata": False, "mediaBytes": False,
    "decodedVideo": False, "browserPlayback": False, "androidPlayback": False,
    "channelListing": "not_attempted", "requests": [], "warnings": [],
    "noCookies": True, "noProxy": True, "noTokenProvider": True,
    "noClientOverrides": True, "stoppedOnAuthorizationBlock": False,
}

class StopProbe(BaseException):
    def __init__(self, code):
        self.code = code

def blocked_status(status):
    return status in (401, 403, 429)

def is_login_body(body):
    try:
        data = json.loads(body)
        status = data.get("playabilityStatus", {}).get("status")
        if status in ("LOGIN_REQUIRED", "AGE_CHECK_REQUIRED", "CONTENT_CHECK_REQUIRED"):
            return True
    except (ValueError, AttributeError):
        pass
    return bool(re.search(rb'"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"(LOGIN_REQUIRED|AGE_CHECK_REQUIRED|CONTENT_CHECK_REQUIRED)"', body))

def approved_manual(text, target):
    for line in text.lstrip("\ufeff").splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        value = re.split(r"\s+//", line, maxsplit=1)[0].strip()
        try:
            u = urlparse(value if "://" in value else "https://" + value)
            if u.scheme not in ("http", "https") or u.username or u.password or u.port:
                continue
            host = (u.hostname or "").lower()
            if host == "youtu.be" and u.path == "/" + target:
                return True
            if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
                if u.path == "/watch" and parse_qs(u.query).get("v") == [target]:
                    return True
                if u.path.rstrip("/") in ("/shorts/" + target, "/live/" + target, "/embed/" + target):
                    return True
        except ValueError:
            continue
    return False

def media_url_allowed(url):
    u = urlparse(url)
    host = u.hostname or ""
    return u.scheme == "https" and not u.username and not u.password and not u.port and (
        host == "googlevideo.com" or host.endswith(".googlevideo.com"))

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise StopProbe("REDIRECT_NOT_FOLLOWED")

class StopOnBlockYDL(yt_dlp.YoutubeDL):
    """Use standard extraction, but halt before any fallback after an explicit block."""
    def urlopen(self, request):
        started = time.monotonic()
        try:
            response = super().urlopen(request)
        except YtdlpHTTPError as e:
            REPORT["requests"].append({"status": e.status, "ms": round((time.monotonic()-started)*1000)})
            if blocked_status(e.status):
                REPORT["stoppedOnAuthorizationBlock"] = True
                raise StopProbe("RATE_LIMITED" if e.status == 429 else "UPSTREAM_BLOCKED")
            raise
        REPORT["requests"].append({"status": response.status, "ms": round((time.monotonic()-started)*1000)})
        if blocked_status(response.status):
            response.close()
            REPORT["stoppedOnAuthorizationBlock"] = True
            raise StopProbe("UPSTREAM_BLOCKED")
        # Preserve exactly the original response bytes; do not modify cookies,
        # headers, identity or playability status. The cap bounds memory.
        content = response.read(8*1024*1024 + 1)
        response.close()
        if len(content) > 8*1024*1024:
            raise StopProbe("RESPONSE_TOO_LARGE")
        if is_login_body(content):
            REPORT["stoppedOnAuthorizationBlock"] = True
            raise StopProbe("UPSTREAM_AUTH_REQUIRED")
        return Response(io.BytesIO(content), response.url, dict(response.headers),
                        status=response.status, reason=response.reason)

class Logger:
    def debug(self, message): pass
    def warning(self, message):
        # Do not persist signed URLs, visitor identifiers, cookies or credentials.
        if "PO Token" in message: category = "TOKEN_REQUIREMENT"
        elif "challenge" in message.lower(): category = "EXTRACTION_JS"
        elif "format" in message.lower(): category = "FORMATS_WARNING"
        else: category = "EXTRACTOR_WARNING"
        if category not in REPORT["warnings"]: REPORT["warnings"].append(category)
    def error(self, message): pass

def main():
    started = time.monotonic()
    opener = build_opener(NoRedirects())
    try:
        with opener.open(Request(LIST_URL, headers={"Cache-Control":"no-cache"}), timeout=8) as response:
            text = response.read(1000001).decode("utf-8")
        if len(text)>1000000 or not approved_manual(text, VIDEO_ID):
            raise StopProbe("VIDEO_NOT_CURRENTLY_APPROVED")
        REPORT["whitelistVerified"] = True
        options = {
            "quiet":True, "no_warnings":False, "logger":Logger(),
            "noplaylist":True, "skip_download":True, "cachedir":False,
            "socket_timeout":8, "retries":0, "extractor_retries":0,
            "fragment_retries":0, "ignoreerrors":False,
            "js_runtimes":{"node":{}},
        }
        # Normal package behavior, no custom client list, cookies, proxies,
        # impersonation setting, anti-bot solver or PO-token plugins.
        with StopOnBlockYDL(options) as ydl:
            info = ydl.extract_info("https://www.youtube.com/watch?v="+VIDEO_ID, download=False)
        if not info or info.get("id") != VIDEO_ID:
            raise StopProbe("METADATA_ID_MISMATCH")
        REPORT["metadata"] = True
        REPORT["title"] = str(info.get("title",""))[:300]
        REPORT["channelId"] = info.get("channel_id")
        formats = [f for f in info.get("formats", []) if
            f.get("vcodec") not in (None,"none") and f.get("acodec") not in (None,"none")
            and f.get("ext") == "mp4" and f.get("protocol") == "https"
            and 0 < (f.get("height") or 0) <= 720 and media_url_allowed(f.get("url",""))]
        REPORT["combinedMp4Formats"] = len(formats)
        if not formats:
            raise StopProbe("NO_COMBINED_MP4_FORMAT")
        chosen = sorted(formats,key=lambda f:f.get("height",0),reverse=True)[0]
        req = Request(chosen["url"],headers={"Range":f"bytes=0-{MAX_BYTES-1}"})
        with opener.open(req,timeout=8) as response:
            if response.status not in (200,206):
                raise StopProbe("MEDIA_HTTP_FAILURE")
            data = response.read(MAX_BYTES)
        REPORT["mediaBytes"] = len(data)>0
        REPORT["mediaByteCount"] = len(data)
        sample = Path("qa/yt-dlp-sample.mp4")
        sample.write_bytes(data)
        result = subprocess.run(["ffmpeg","-v","error","-i",str(sample),
                                "-frames:v","3","-f","null","-"],
                                capture_output=True,timeout=12,check=False)
        sample.unlink(missing_ok=True)
        REPORT["decodedVideo"] = result.returncode == 0 and len(data)>0
        REPORT["outcome"] = "DECODED_SAMPLE" if REPORT["decodedVideo"] else "MEDIA_SAMPLE_NOT_DECODABLE"
    except StopProbe as e:
        REPORT["outcome"] = e.code
    except HTTPError as e:
        REPORT["outcome"] = "UPSTREAM_BLOCKED" if blocked_status(e.code) else "HTTP_FAILURE"
        REPORT["stoppedOnAuthorizationBlock"] = blocked_status(e.code)
    except yt_dlp.utils.DownloadError as e:
        message = str(e).lower()
        REPORT["outcome"] = "UPSTREAM_BLOCKED" if "not a bot" in message or "sign in" in message else "EXTRACTION_FAILED"
        REPORT["stoppedOnAuthorizationBlock"] = REPORT["outcome"] == "UPSTREAM_BLOCKED"
    except subprocess.TimeoutExpired:
        REPORT["outcome"] = "DECODE_TIMEOUT"
    except (URLError, TimeoutError):
        REPORT["outcome"] = "NETWORK_FAILURE"
    except Exception as e:
        REPORT["outcome"] = "PROBE_FAILURE"
        REPORT["exceptionType"] = type(e).__name__
    finally:
        REPORT["elapsedMs"] = round((time.monotonic()-started)*1000)
        OUTPUT.parent.mkdir(exist_ok=True)
        OUTPUT.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps(REPORT,ensure_ascii=False,indent=2))
    return 0 if REPORT["decodedVideo"] else 1

if __name__ == "__main__":
    def deadline(signum, frame):
        raise StopProbe("PROBE_DEADLINE")
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(45)
    raise SystemExit(main())
