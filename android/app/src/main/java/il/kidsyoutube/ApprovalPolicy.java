// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;

/** The native authorization boundary. JS/localStorage never supply grants. */
public final class ApprovalPolicy {
    public static final Pattern VIDEO = Pattern.compile("[A-Za-z0-9_-]{11}");
    public static final Pattern CHANNEL = Pattern.compile("UC[A-Za-z0-9_-]{22}");
    public final Set<String> videos;
    public final Set<String> channels;
    public final Set<String> channelUrls;
    public final String fingerprint;

    private ApprovalPolicy(Set<String> videos, Set<String> channels, Set<String> urls) {
        this.videos = Collections.unmodifiableSet(videos);
        this.channels = Collections.unmodifiableSet(channels);
        this.channelUrls = Collections.unmodifiableSet(urls);
        this.fingerprint = videos.toString() + channels + urls;
    }
    public static ApprovalPolicy parse(String text) {
        if (text == null || text.length() > 1000000) throw new IllegalArgumentException("INVALID_LIST");
        Set<String> videos = new LinkedHashSet<>(), channels = new LinkedHashSet<>(), urls = new LinkedHashSet<>();
        for (String line : text.replace("\uFEFF","").split("\\r?\\n")) {
            String input = line.trim();
            if (input.isEmpty() || input.startsWith("//")) continue;
            input = input.split("\\s+//",2)[0].trim();
            try {
                Link link = classify(input);
                if (link.videoId != null) videos.add(link.videoId);
                else {
                    urls.add(link.url);
                    if (link.channelId != null) channels.add(link.channelId);
                }
            } catch (IllegalArgumentException ignored) { /* Invalid lines approve nothing. */ }
        }
        return new ApprovalPolicy(videos,channels,urls);
    }
    public static final class Link {
        public final String url, videoId, channelId;
        Link(String url, String video, String channel) {this.url=url;videoId=video;channelId=channel;}
    }
    public static Link classify(String input) {
        try {
            if (input == null || input.length() > 4096 || input.matches(".*\\s.*")) throw new IllegalArgumentException();
            URI u = URI.create(input.matches("(?i)^https?://.*") ? input : "https://" + input);
            if (!"https".equalsIgnoreCase(u.getScheme()) && !"http".equalsIgnoreCase(u.getScheme())) throw new IllegalArgumentException();
            if (u.getRawUserInfo() != null || u.getPort() != -1 || u.getHost() == null) throw new IllegalArgumentException();
            String host = u.getHost().toLowerCase(Locale.ROOT), path = u.getPath();
            if (host.equals("youtu.be")) {
                String id = path.replaceFirst("^/","");
                if (!VIDEO.matcher(id).matches()) throw new IllegalArgumentException();
                return new Link("https://www.youtube.com/watch?v="+id,id,null);
            }
            if (!Set.of("youtube.com","www.youtube.com","m.youtube.com","music.youtube.com").contains(host)) throw new IllegalArgumentException();
            String id = null;
            if ("/watch".equals(path)) id = query(u.getRawQuery(),"v");
            else if (path.matches("/(shorts|live|embed)/[A-Za-z0-9_-]{11}/?")) id = path.split("/")[2];
            if (id != null) {
                if (!VIDEO.matcher(id).matches()) throw new IllegalArgumentException();
                return new Link("https://www.youtube.com/watch?v="+id,id,null);
            }
            String trimmed = path.replaceFirst("/+$","");
            if (trimmed.matches("/channel/UC[A-Za-z0-9_-]{22}(/(videos|shorts|streams|featured))?")) {
                String cid = trimmed.split("/")[2];
                return new Link("https://www.youtube.com/channel/"+cid,null,cid);
            }
            if (trimmed.matches("/@[\\p{L}\\p{N}_.-]{1,100}(/(videos|shorts|streams|featured))?")) {
                return new Link("https://www.youtube.com/"+trimmed.split("/")[1],null,null);
            }
            if (trimmed.matches("/(c|user)/[\\p{L}\\p{N}_.-]{1,100}(/(videos|shorts|streams|featured))?")) {
                return new Link("https://www.youtube.com/"+trimmed.split("/")[1]+"/"+trimmed.split("/")[2],null,null);
            }
            throw new IllegalArgumentException();
        } catch (RuntimeException e) {throw new IllegalArgumentException("INVALID_LINK");}
    }
    static String query(String query, String key) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            String[] pair=part.split("=",2);
            if (URLDecoder.decode(pair[0],StandardCharsets.UTF_8).equals(key))
                return pair.length==2 ? URLDecoder.decode(pair[1],StandardCharsets.UTF_8) : "";
        }
        return null;
    }
    public boolean allows(String videoId, String authorId, Set<String> resolvedChannels) {
        return VIDEO.matcher(videoId).matches() && (videos.contains(videoId)
                || (authorId != null && CHANNEL.matcher(authorId).matches()
                    && (channels.contains(authorId) || resolvedChannels.contains(authorId))));
    }
    public static boolean safeMedia(String value) {
        try {
            URI u=URI.create(value);
            String h=u.getHost();
            return "https".equals(u.getScheme()) && u.getRawUserInfo()==null && u.getPort()==-1
                    && h!=null && (h.equals("googlevideo.com") || h.endsWith(".googlevideo.com"));
        } catch (RuntimeException e) {return false;}
    }
}
