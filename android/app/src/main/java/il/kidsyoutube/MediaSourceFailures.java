// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.util.HashMap;
import java.util.Map;
import java.util.List;
import okhttp3.HttpUrl;

/** One playback only. Both loader threads report here before Media3 chooses one error.
 * URLs are retained only in memory for exact equality; never log this object or its keys.
 */
final class MediaSourceFailures {
    private final Map<HttpUrl,Integer> rejected=new HashMap<>();

    synchronized void record(String originalUrl,int status){
        if(status!=401 && status!=403 && status!=429)return;
        HttpUrl key=HttpUrl.parse(originalUrl);
        if(key!=null)rejected.put(key,status);
    }
    synchronized boolean rejected(String url){
        return url!=null && rejected.containsKey(HttpUrl.parse(url));
    }
    synchronized boolean accepts(String video,String audio){
        return !rejected(video) && !rejected(audio);
    }
    synchronized boolean rateLimited(){return rejected.containsValue(429);}
    synchronized int nextEligible(List<NativeApi.Source> sources,List<Integer> order,int index){
        while(index<order.size() && index<6){
            NativeApi.Source next=sources.get(order.get(index));
            if(accepts(next.video,next.audio))break;
            index++;
        }
        return index;
    }
}
