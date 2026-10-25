package il.kidsyoutube;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

public final class FamilyPlaybackLeaseGateTest {
 private static final String A="abcdefghijk",B="ABCDEFGHIJK";
 private static void denied(FamilyPlaybackLeaseGate gate,FamilyPlaybackLeaseGate.Permit p,String id){
  try{gate.requireAuthorized(p,id);fail("unexpected permit");}
  catch(IOException expected){assertEquals("FAMILY_PLAYBACK_DENIED",expected.getMessage());}
 }
 @Test public void approvedPermitIsOnlyForExactVideoAndExpires() throws Exception {
  AtomicLong now=new AtomicLong(1000);
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->{},now::get);
  FamilyPlaybackLeaseGate.Permit p=gate.request(A);
  gate.requireAuthorized(p,A);
  denied(gate,p,B);
  now.set(6000);
  denied(gate,p,A);
 }
 @Test public void denialInvalidatesPreviousAuthorization() throws Exception {
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->{
   if(B.equals(id))throw new IOException("FAMILY_NOT_APPROVED");
  });
  FamilyPlaybackLeaseGate.Permit first=gate.request(A);
  try{gate.request(B);fail("denied request accepted");}
  catch(IOException expected){assertEquals("FAMILY_NOT_APPROVED",expected.getMessage());}
  denied(gate,first,A);
 }
 @Test public void explicitStopAndSourceSwitchRequireNewRemoteCheck() throws Exception {
  AtomicInteger calls=new AtomicInteger();
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->calls.incrementAndGet());
  FamilyPlaybackLeaseGate.Permit old=gate.request(A);
  gate.invalidate();
  denied(gate,old,A);
  FamilyPlaybackLeaseGate.Permit next=gate.request(A);
  assertEquals(2,calls.get());
  denied(gate,old,A);
  gate.requireAuthorized(next,A);
 }
 @Test public void invalidIdNeverCallsAuthorization() throws Exception {
  AtomicInteger calls=new AtomicInteger();
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->calls.incrementAndGet());
  try{gate.request("not_a_video");fail("invalid ID");}
  catch(IOException expected){assertEquals("INVALID_VIDEO_ID",expected.getMessage());}
  assertEquals(0,calls.get());
 }
}
