// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Strict, family-scoped explicit-video catalog. Never reads the legacy catalog. */
final class FamilyVideoCatalog {
    final long version;
    final Set<String> videoIds;
    private FamilyVideoCatalog(long version,Set<String> videos){
        this.version=version;
        this.videoIds=Collections.unmodifiableSet(videos);
    }
    static FamilyVideoCatalog fromServer(JSONObject data) throws IOException {
        if(data==null || !(data.opt("contract") instanceof Number) ||
                data.optInt("contract",-1)!=1 || !(data.opt("version") instanceof Number) ||
                data.optLong("version",-1)<1)throw new IOException("INVALID_FAMILY_CATALOG");
        JSONArray items=data.optJSONArray("videos");
        if(items==null||items.length()>2000)throw new IOException("INVALID_FAMILY_CATALOG");
        Set<String> videos=new LinkedHashSet<>();
        for(int i=0;i<items.length();i++){
            Object id=items.opt(i);
            if(!(id instanceof String) || !ApprovalPolicy.VIDEO.matcher((String)id).matches()
                    || !videos.add((String)id))
                throw new IOException("INVALID_FAMILY_CATALOG");
        }
        return new FamilyVideoCatalog(data.optLong("version"),videos);
    }
    void assertMatches(FamilyApprovalSnapshot grants) throws IOException {
        if(grants==null || grants.version!=version)
            throw new IOException("FAMILY_CATALOG_VERSION_CHANGED");
        if(!grants.policy.videos.equals(videoIds))
            throw new IOException("FAMILY_CATALOG_GRANTS_MISMATCH");
    }
}
