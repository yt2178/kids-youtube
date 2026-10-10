// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.util.*;

/** Deterministic fixed-quality MP4 selection. No claim of DASH/HLS adaptation. */
final class PlaybackChoices {
    private PlaybackChoices(){}
    static List<Integer> order(List<Integer> bitrates,List<Integer> heights,String mode,long bandwidthBps){
        if(bitrates.size()!=heights.size()||bitrates.isEmpty())return List.of();
        List<Integer> sorted=new ArrayList<>();
        for(int i=0;i<bitrates.size();i++)sorted.add(i);
        sorted.sort(Comparator.comparingInt((Integer i)->Math.max(1,bitrates.get(i)))
                .thenComparingInt(i->heights.get(i)));
        final long sample=bandwidthBps>0?bandwidthBps:650000L;
        final long budget="save".equals(mode)?Math.min(300000L,Math.max(150000L,sample*55/100))
                :Math.min(1400000L,Math.max(200000L,sample*65/100));
        int preferred=sorted.get(0);
        if(mode!=null&&mode.startsWith("manual:")){
            int requested;
            try{requested=Integer.parseInt(mode.substring(7));}catch(NumberFormatException ignored){requested=0;}
            if(requested>0){
                for(int i:sorted)if(heights.get(i)<=requested&&heights.get(i)>=heights.get(preferred))preferred=i;
            }
        }else{
            for(int i:sorted)if(bitrates.get(i)<=budget)preferred=i;
        }
        List<Integer> plan=new ArrayList<>();plan.add(preferred);
        // Rebuffer failures step DOWN first, not blindly up to 720p.
        for(int j=sorted.indexOf(preferred)-1;j>=0;j--)plan.add(sorted.get(j));
        // A failed low-quality URL can be tried at another available quality.
        for(int j=sorted.indexOf(preferred)+1;j<sorted.size();j++)plan.add(sorted.get(j));
        return plan;
    }
}
