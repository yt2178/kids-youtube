// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import org.json.JSONObject;

/**
 * Authenticated family-only authorization snapshot.
 * This is not a legacy authorization response and cannot be fed to
 * NativeApi's legacy catalog or playback paths.
 */
final class FamilyApprovalSnapshot {
    final long version;
    final String list;
    final ApprovalPolicy policy;

    private FamilyApprovalSnapshot(long version,String list,ApprovalPolicy policy){
        this.version=version;this.list=list;this.policy=policy;
    }

    static FamilyApprovalSnapshot fromDevicePlaybackGrants(JSONObject response) throws IOException {
        if(response==null || !(response.opt("contract") instanceof Number)
                || response.optInt("contract",-1)!=1)
            throw new IOException("INVALID_PLAYBACK_GRANTS_CONTRACT");
        return fromAuthorizedResponse(response);
    }

    static FamilyApprovalSnapshot fromAuthorizedResponse(JSONObject response) throws IOException {
        if(response==null || !response.has("list") || !response.has("version")
                || !(response.opt("list") instanceof String)
                || !(response.opt("version") instanceof Number))
            throw new IOException("INVALID_FAMILY_AUTH_RESPONSE");
        long version=response.optLong("version",-1);
        String text=response.optString("list","");
        if(version<1 || text.length()>1000000)
            throw new IOException("INVALID_FAMILY_AUTH_RESPONSE");
        try{
            ApprovalPolicy policy=ApprovalPolicy.parse(text);
            return new FamilyApprovalSnapshot(version,text,policy);
        }catch(RuntimeException e){
            throw new IOException("INVALID_FAMILY_APPROVALS",e);
        }
    }
}
