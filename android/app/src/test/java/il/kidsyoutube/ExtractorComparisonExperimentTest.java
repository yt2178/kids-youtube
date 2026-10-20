package il.kidsyoutube;
import java.util.*;
import org.junit.Test;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.stream.StreamExtractor;
import static org.junit.Assert.*;
/** Experimental CI-only comparison, never called by the Android app. */
public class ExtractorComparisonExperimentTest {
 @Test public void inspectKnownIdsWithoutDownloading() {
  if(!"1".equals(System.getenv("KIDS_COMPARE_EXTRACTORS")))return;
  NewPipe.init(new ExtractorDownloader(false));
  for(String id:new String[]{"87H7vZbPp1U","OibO9vgZbN8","mVTlbvQ_010"}) {
   long start=System.nanoTime();
   String result="FAIL",failure="none";
   int progressive=0,adaptive=0,audio=0;
   try {
    StreamExtractor extractor=ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v="+id);
    extractor.fetchPage();
    progressive=extractor.getVideoStreams().size();
    adaptive=extractor.getVideoOnlyStreams().size();
    audio=extractor.getAudioStreams().size();
    result=(progressive+adaptive>0)?"METADATA_OK":"NO_VIDEO_FORMATS";
   }catch(Exception e){failure=e.getClass().getSimpleName();}
   long ms=(System.nanoTime()-start)/1000000;
   System.out.println("COMPARE_NEWPIPE id="+id+" result="+result+" progressive="+progressive+" adaptive="+adaptive+" audio="+audio+" elapsed_ms="+ms+" error_type="+failure);
  }
 }
}
