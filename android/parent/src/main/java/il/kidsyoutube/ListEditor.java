// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import java.util.*;
/** Apply one addition/removal to the CURRENT remote file; preserve other parents' work. */
public final class ListEditor {
    public static final class Entry {
        public final ApprovalPolicy.Link link;
        public final String title;
        Entry(ApprovalPolicy.Link link,String title){this.link=link;this.title=title;}
    }
    public static List<Entry> entries(String text) {
        if(text==null || text.length()>1000000 || text.replace("\uFEFF","").trim().startsWith("{"))
            throw new IllegalArgumentException("INVALID_LIST");
        List<Entry> result=new ArrayList<>();
        for(String line:text.replace("\uFEFF","").split("\\r?\\n")) {
            String trimmed=line.trim();
            if(trimmed.isEmpty() || trimmed.startsWith("//"))continue;
            String[] parts=trimmed.split("\\s+//",2);
            try {result.add(new Entry(ApprovalPolicy.classify(parts[0].trim()),parts.length>1?parts[1].trim():""));}
            catch(IllegalArgumentException ignored){}
        }
        return result;
    }
    public static boolean contains(String text,String canonical,String original) {
        for(Entry entry:entries(text))if(entry.link.url.equals(canonical) || entry.link.url.equals(original))return true;
        return false;
    }
    public static String comment(String value) {
        if(value==null)return "";
        String clean=value.replace('\n',' ').replace('\r',' ').replace('\uFEFF',' ').trim().replaceAll("\\s+"," ");
        return clean.substring(0,Math.min(clean.length(),500));
    }
    public static String add(String text,String canonical,String original,String title,String note) {
        ApprovalPolicy.Link link=ApprovalPolicy.classify(canonical);
        if(contains(text,link.url,original))return text;
        String description=comment(title),personal=comment(note);
        if(!personal.isEmpty())description+=(description.isEmpty()?"":" — ")+personal;
        String out=text+(text.isEmpty() || text.endsWith("\n")?"":"\n")+link.url
                +(description.isEmpty()?"":" // "+description)+"\n";
        if(out.length()>1000000)throw new IllegalArgumentException("LIST_TOO_LARGE");
        return out;
    }
    public static String remove(String text,String target) {
        String url=ApprovalPolicy.classify(target).url;
        entries(text);
        StringBuilder out=new StringBuilder();
        for(String line:text.split("\n",-1)) {
            String input=line.replace("\uFEFF","").trim();
            boolean remove=false;
            if(!input.isEmpty() && !input.startsWith("//")) {
                try{remove=ApprovalPolicy.classify(input.split("\\s+//",2)[0].trim()).url.equals(url);}
                catch(IllegalArgumentException ignored){}
            }
            if(!remove)out.append(line).append('\n');
        }
        if(out.length()>0)out.setLength(out.length()-1);
        return out.toString();
    }
}
