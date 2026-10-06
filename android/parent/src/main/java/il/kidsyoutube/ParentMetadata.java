// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import java.io.IOException;
import java.net.URI;
import java.util.*;
import org.schabi.newpipe.extractor.*;
import org.schabi.newpipe.extractor.channel.ChannelInfo;
import org.schabi.newpipe.extractor.stream.StreamExtractor;
final class ParentMetadata {
    static final class Preview {
        final ApprovalPolicy.Link original;
        final String canonical,title,author,thumbnail;
        final boolean channel;
        Preview(ApprovalPolicy.Link original,String canonical,String title,String author,String thumbnail,boolean channel){
            this.original=original;this.canonical=canonical;this.title=title;this.author=author;this.thumbnail=thumbnail;this.channel=channel;
        }
    }
    final ExtractorDownloader downloader=new ExtractorDownloader();
    private long cooldown;
    ParentMetadata(){NewPipe.init(downloader);}
    Preview load(ApprovalPolicy.Link link) throws Exception {
        if(System.currentTimeMillis()<cooldown)throw new IOException("UNAVAILABLE");
        try {
            if(link.videoId!=null) {
                StreamExtractor e=ServiceList.YouTube.getStreamExtractor(link.url);e.fetchPage();
                if(!link.videoId.equals(e.getId()) || e.getName()==null || e.getName().isBlank())
                    throw new IOException("INVALID_VIDEO");
                return new Preview(link,link.url,e.getName(),e.getUploaderName(),image(e.getThumbnails()),false);
            }
            ChannelInfo e=ChannelInfo.getInfo(ServiceList.YouTube,link.url);
            if(!ApprovalPolicy.CHANNEL.matcher(e.getId()).matches() || e.getName()==null || e.getName().isBlank())
                throw new IOException("INVALID_CHANNEL");
            return new Preview(link,"https://www.youtube.com/channel/"+e.getId(),e.getName(),"אישור ערוץ מאפשר גם סרטונים חדשים שלו",image(e.getAvatars()),true);
        }catch(Exception e){
            for(Throwable cause=e;cause!=null;cause=cause.getCause())
                if(cause instanceof org.schabi.newpipe.extractor.exceptions.ReCaptchaException
                    || String.valueOf(cause.getMessage()).contains("UPSTREAM_BLOCKED")
                    || String.valueOf(cause.getMessage()).contains("RATE_LIMITED"))
                    cooldown=System.currentTimeMillis()+2*60*1000;
            throw e;
        }
    }
    private static String image(List<Image> rows){
        for(Image image:rows)if(safeImage(image.getUrl()))return image.getUrl();
        return "";
    }
    static boolean safeImage(String input) {
        try{URI u=URI.create(input);String h=u.getHost();return "https".equals(u.getScheme())
                && u.getRawUserInfo()==null && u.getPort()==-1 && h!=null
                && (h.equals("ytimg.com") || h.endsWith(".ytimg.com") || h.equals("ggpht.com")
                || h.endsWith(".ggpht.com") || h.equals("googleusercontent.com") || h.endsWith(".googleusercontent.com"));}
        catch(RuntimeException e){return false;}
    }
}

