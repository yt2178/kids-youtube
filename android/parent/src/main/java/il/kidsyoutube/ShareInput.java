// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import java.util.*;
import java.util.regex.*;
/** Incoming shares are untrusted text, not commands, HTML or content URIs. */
public final class ShareInput {
    private static final Pattern URL=Pattern.compile("https?://[^\\s<>\"']+",Pattern.CASE_INSENSITIVE);
    public static ApprovalPolicy.Link parse(String text) {
        if(text==null || text.length()>20000)throw new IllegalArgumentException("INVALID_LINK");
        Map<String,ApprovalPolicy.Link> links=new LinkedHashMap<>();
        Matcher matcher=URL.matcher(text);
        while(matcher.find()) {
            String candidate=matcher.group().replaceAll("[),;\\]]+$","");
            try {
                ApprovalPolicy.Link link=ApprovalPolicy.classify(candidate);
                links.put(link.url,link);
            }catch(IllegalArgumentException ignored){}
        }
        if(links.isEmpty()) {
            ApprovalPolicy.Link link=ApprovalPolicy.classify(text.trim());
            links.put(link.url,link);
        }
        if(links.size()!=1)throw new IllegalArgumentException("ONE_LINK_ONLY");
        return links.values().iterator().next();
    }
}

