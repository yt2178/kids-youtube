import unittest
from yt_dlp_probe import approved_manual,media_url_allowed,is_login_body,blocked_status
class ProbeGuards(unittest.TestCase):
    def test_manual_share_and_comments(self):
        self.assertTrue(approved_manual("// note\nhttps://youtu.be/mVTlbvQ_010?si=x // note","mVTlbvQ_010"))
    def test_watch_url(self):
        self.assertTrue(approved_manual("https://www.youtube.com/watch?v=mVTlbvQ_010","mVTlbvQ_010"))
    def test_comments_do_not_approve(self):
        self.assertFalse(approved_manual("// https://youtu.be/mVTlbvQ_010","mVTlbvQ_010"))
    def test_credentials_and_fake_hosts(self):
        for url in ("https://user@youtube.com/watch?v=mVTlbvQ_010","https://youtube.com.evil.test/watch?v=mVTlbvQ_010","https://youtu.be/mVTlbvQ_010/bad"):
            self.assertFalse(approved_manual(url,"mVTlbvQ_010"))
    def test_media_allowlist(self):
        self.assertTrue(media_url_allowed("https://rr1.googlevideo.com/videoplayback?x=y"))
        self.assertFalse(media_url_allowed("https://googlevideo.com.evil.test/a"))
        self.assertFalse(media_url_allowed("http://rr1.googlevideo.com/a"))
    def test_auth_block_is_detected(self):
        self.assertTrue(is_login_body(b'{"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in"}}'))
        self.assertTrue(is_login_body(b'<script>var response={"playabilityStatus":{"status":"AGE_CHECK_REQUIRED"}};</script>'))
    def test_ok_playability_is_not_a_block(self):
        self.assertFalse(is_login_body(b'{"playabilityStatus":{"status":"OK"}}'))
    def test_denials_stop_attempts(self):
        for status in (401,403,429):self.assertTrue(blocked_status(status))
        self.assertFalse(blocked_status(200))
if __name__=="__main__":unittest.main()
