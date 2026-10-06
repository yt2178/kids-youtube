// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Set;
public class ApprovalPolicyTest {
    static final String VID="mVTlbvQ_010", CID="UCV6xoqUxJzkWwCbDmEwMSYw";
    @Test public void commentsAndShareParameters(){
        ApprovalPolicy p=ApprovalPolicy.parse("\uFEFF// note\r\nhttps://youtu.be/"+VID+"?si=abc // my note\r\n");
        assertEquals(Set.of(VID),p.videos);assertTrue(p.channels.isEmpty());
    }
    @Test public void normalizeVideoVariants(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://www.youtube.com/watch?v="+VID+"\nhttps://youtu.be/"+VID+"\nhttps://music.youtube.com/watch?v="+VID+"\nhttps://youtube.com/shorts/"+VID+"\nhttps://youtube.com/live/"+VID);
        assertEquals(1,p.videos.size());
    }
    @Test public void channelLinkAndTabAreOneApproval(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://youtube.com/channel/"+CID+"\nhttps://www.youtube.com/channel/"+CID+"/videos");
        assertEquals(Set.of(CID),p.channels);assertEquals(1,p.channelUrls.size());
    }
    @Test public void handleCustomAndLegacyChannels(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://youtube.com/@meirshows/videos\nhttps://youtube.com/c/meirshows\nhttps://youtube.com/user/meirshows");
        assertEquals(3,p.channelUrls.size());assertTrue(p.channels.isEmpty());
    }
    @Test public void maliciousAndUnsupportedLinksApproveNothing(){
        ApprovalPolicy p=ApprovalPolicy.parse("javascript:alert(1)\nhttps://youtube.com.attacker.test/watch?v="+VID+"\nhttps://evil@youtube.com/watch?v="+VID+"\nhttps://youtube.com:443/watch?v="+VID+"\nhttps://youtube.com/playlist?list=abc\nhttps://youtu.be/"+VID+"/bad\nhttps://youtube.com/channel/UC_FAKE\nhttps://youtube.com/watch?v=<script>");
        assertTrue(p.videos.isEmpty());assertTrue(p.channels.isEmpty());assertTrue(p.channelUrls.isEmpty());
    }
    @Test public void manuallyApprovedVideoNeedsNoExternalMetadata(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://youtu.be/"+VID);
        assertTrue(p.allows(VID,null,Set.of()));
        assertFalse(p.allows("AAAAAAAAAAA",null,Set.of()));
    }
    @Test public void channelApprovalRequiresAnAuthorMatch(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://youtube.com/channel/"+CID);
        assertTrue(p.allows(VID,CID,Set.of()));
        assertFalse(p.allows(VID,"UC0000000000000000000000",Set.of()));
        assertFalse(p.allows(VID,null,Set.of()));
    }
    @Test public void parentRemovalAndEmptyListRevokeApprovals(){
        ApprovalPolicy before=ApprovalPolicy.parse("https://youtu.be/"+VID+"\nhttps://youtube.com/channel/"+CID);
        ApprovalPolicy after=ApprovalPolicy.parse("// removed all");
        assertTrue(before.allows(VID,CID,Set.of()));
        assertFalse(after.allows(VID,CID,Set.of()));
        assertNotEquals(before.fingerprint,after.fingerprint);
    }
    @Test public void signedMediaUrlsAreLimitedToHttpsGooglevideo(){
        assertTrue(ApprovalPolicy.safeMedia("https://rr1.googlevideo.com/videoplayback?expire=1"));
        assertFalse(ApprovalPolicy.safeMedia("http://rr1.googlevideo.com/videoplayback"));
        assertFalse(ApprovalPolicy.safeMedia("https://googlevideo.com.evil.test/"));
        assertFalse(ApprovalPolicy.safeMedia("https://user@rr1.googlevideo.com/a"));
        assertFalse(ApprovalPolicy.safeMedia("https://rr1.googlevideo.com:444/a"));
        assertFalse(ApprovalPolicy.safeMedia("file:///sdcard/a"));
    }
    @Test public void approvalGroupsRemainSeparate(){
        ApprovalPolicy p=ApprovalPolicy.parse("https://youtu.be/"+VID+"\nhttps://youtube.com/@meirshows");
        assertEquals(Set.of(VID),p.videos);
        assertTrue(p.channels.isEmpty());assertEquals(1,p.channelUrls.size());
        assertTrue(p.allows("AAAAAAAAAAA",CID,Set.of(CID)));
    }
}
