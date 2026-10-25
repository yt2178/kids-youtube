// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;

/**
 * Prototype-only pre-playback authorization boundary.
 * Every requested video needs fresh device-authenticated grants AND the matching catalog.
 * This never references the legacy player or persists grants across requests.
 */
final class FamilyPlaybackGuard {
    private final FamilyAuthClient auth;
    FamilyPlaybackGuard(FamilyAuthClient auth){this.auth=auth;}
    void authorizeVideo(String accessToken,String videoId) throws IOException {
        if(videoId==null||!ApprovalPolicy.VIDEO.matcher(videoId).matches())
            throw new IOException("INVALID_VIDEO_ID");
        FamilyApprovalSnapshot grants=FamilyApprovalSnapshot.fromDevicePlaybackGrants(
                auth.playbackGrants(accessToken));
        FamilyVideoCatalog catalog=FamilyVideoCatalog.fromServer(
                auth.catalogIds(accessToken));
        catalog.assertMatches(grants);
        if(!grants.policy.videos.contains(videoId)||!catalog.videoIds.contains(videoId))
            throw new IOException("FAMILY_NOT_APPROVED");
    }
}
