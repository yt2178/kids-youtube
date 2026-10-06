package il.kidsyoutube;
import org.junit.Test;
import static org.junit.Assert.*;
public class ParentLogicTest {
    final String video="https://www.youtube.com/watch?v=mVTlbvQ_010";
    final String other="https://www.youtube.com/watch?v=AAAAAAAAAAA";
    final String channel="https://www.youtube.com/channel/UCV6xoqUxJzkWwCbDmEwMSYw";
    @Test public void sharedTitleAndUrl(){assertEquals(video,ShareInput.parse("סרטון טוב\nhttps://youtu.be/mVTlbvQ_010?si=abc").url);}
    @Test public void multipleDifferentLinksNeedAChoice(){
        assertThrows(IllegalArgumentException.class,()->ShareInput.parse(video+" "+other));
    }
    @Test public void repeatedSameLinkIsOneCandidate(){assertEquals(video,ShareInput.parse(video+" https://youtu.be/mVTlbvQ_010").url);}
    @Test public void sharingChannelAutomaticallyClassifies(){assertNull(ShareInput.parse("https://youtube.com/@meirshows").videoId);}
    @Test public void invalidSharesCannotBecomeHtmlOrCommands(){
        for(String s:new String[]{"javascript:alert(1)","content://photo/123","https://youtube.com.attacker.test/watch?v=mVTlbvQ_010","https://name@youtube.com/watch?v=mVTlbvQ_010"})
            assertThrows(IllegalArgumentException.class,()->ShareInput.parse(s));
    }
    @Test public void hugeShareIsRejected(){assertThrows(IllegalArgumentException.class,()->ShareInput.parse("x".repeat(20001)));}
    @Test public void addPreservesCommentsAndOtherParentEntries(){
        String raw="// parent note\n"+other+" // אבא\n";
        String updated=ListEditor.add(raw,video,video,"השם שלי","הערה");
        assertTrue(updated.startsWith(raw));assertTrue(updated.endsWith(video+" // השם שלי — הערה\n"));
    }
    @Test public void differentVideoUrlFormsDoNotDuplicate(){
        String raw="https://youtu.be/mVTlbvQ_010?si=abc // existing\n";
        assertEquals(raw,ListEditor.add(raw,video,video,"new",""));
    }
    @Test public void anExistingHandleAndItsResolvedChannelDoNotDuplicate(){
        String raw="https://youtube.com/@meirshows // existing\n";
        assertEquals(raw,ListEditor.add(raw,channel,"https://www.youtube.com/@meirshows","מאיר",""));
    }
    @Test public void notesAndTitlesCannotInjectApprovals(){
        String added=ListEditor.add("",video,video,"שם\n"+other,"\r\n"+channel);
        assertEquals(1,ListEditor.entries(added).size());
        assertEquals(video,ListEditor.entries(added).get(0).link.url);
    }
    @Test public void removingVideoPreservesChannelAndOtherVideo(){
        String raw="// keep\n"+video+" // title\n"+channel+"\n"+other+"\n";
        String removed=ListEditor.remove(raw,video);
        assertFalse(ListEditor.contains(removed,video,video));
        assertTrue(ListEditor.contains(removed,channel,channel));
        assertTrue(ListEditor.contains(removed,other,other));assertTrue(removed.startsWith("// keep"));
    }
    @Test public void removingChannelPreservesSeparateVideoApproval(){
        String raw=channel+"\n"+video;
        String updated=ListEditor.remove(raw,channel);
        assertTrue(ListEditor.contains(updated,video,video));
        assertFalse(ListEditor.contains(updated,channel,channel));
    }
    @Test public void malformedLegacyListFailsClosedBeforeAnyWrite(){
        assertThrows(IllegalArgumentException.class,()->ListEditor.add("{\"videos\":[]}",video,video,"",""));
        assertThrows(IllegalArgumentException.class,()->ListEditor.add("\uFEFF{\"videos\":[]}",video,video,"",""));
    }
    @Test public void emptyCommentedListCanReceiveFirstApproval(){
        assertEquals(1,ListEditor.entries(ListEditor.add("// hello",video,video,"ראשון","")).size());
    }
    @Test public void removalIsIdempotent(){
        String once=ListEditor.remove(video+"\n"+other,video);assertEquals(once,ListEditor.remove(once,video));
    }
}
