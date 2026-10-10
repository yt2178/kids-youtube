// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;
public class PlaybackChoicesTest {
    private final List<Integer> bits=List.of(180000,350000,700000,1200000,2100000);
    private final List<Integer> heights=List.of(144,240,360,480,720);
    @Test public void slow256kPicks144AndDoesNotAssumeWifiFast(){
        assertEquals(Integer.valueOf(0),PlaybackChoices.order(bits,heights,"auto",256000).get(0));
    }
    @Test public void oneMbpsPicks240AndThenDowngrades(){
        assertEquals(List.of(1,0,2,3,4),PlaybackChoices.order(bits,heights,"auto",1000000));
    }
    @Test public void dataSaverPicksLowestSustainableOption(){
        assertEquals(Integer.valueOf(0),PlaybackChoices.order(bits,heights,"save",256000).get(0));
    }
    @Test public void manualOnlySelectsPresentQuality(){
        assertEquals(Integer.valueOf(2),PlaybackChoices.order(bits,heights,"manual:360",256000).get(0));
        assertEquals(Integer.valueOf(1),PlaybackChoices.order(bits,heights,"manual:300",1000000).get(0));
    }
    @Test public void noAdaptiveManifestClaimsAndEmptyList(){
        assertTrue(PlaybackChoices.order(List.of(),List.of(),"auto",0).isEmpty());
        assertEquals(Integer.valueOf(1),PlaybackChoices.order(bits,heights,"auto",0).get(0));
    }
}
