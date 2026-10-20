#!/usr/bin/env python3
"""Read-only comparison, never prints signed URLs, cookies or tokens."""
import concurrent.futures, json, subprocess, time
IDS=("87H7vZbPp1U","OibO9vgZbN8","mVTlbvQ_010")
for video_id in IDS:
    started=time.monotonic()
    try:
        p=subprocess.run(["python","-m","yt_dlp","--ignore-config","--no-playlist","--skip-download",
            "--dump-single-json","--no-warnings","--no-progress",
            "--socket-timeout","12","--retries","0","--extractor-retries","0",
            "https://www.youtube.com/watch?v="+video_id],
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=35)
        if p.returncode:
            outcome="EXTRACTION_FAILED"; count=0; audio=0; video=0
        else:
            data=json.loads(p.stdout)
            formats=data.get("formats",[])
            count=len(formats)
            video=sum(1 for f in formats if f.get("vcodec") not in ("none",None))
            audio=sum(1 for f in formats if f.get("acodec") not in ("none",None))
            outcome="METADATA_OK" if video else "NO_VIDEO_FORMATS"
    except (subprocess.TimeoutExpired,ValueError,KeyError) as exc:
        outcome=type(exc).__name__;count=audio=video=0
    print(f"COMPARE_YTDLP id={video_id} result={outcome} formats={count} video={video} audio={audio} elapsed_ms={int((time.monotonic()-started)*1000)}",flush=True)
