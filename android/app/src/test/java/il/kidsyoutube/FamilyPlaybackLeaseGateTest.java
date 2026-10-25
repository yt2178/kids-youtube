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
  try{gate.request("invalid video id");fail("invalid ID");}
  catch(IOException expected){assertEquals("INVALID_VIDEO_ID",expected.getMessage());}
  assertEquals(0,calls.get());
 }
 @Test public void stopInvalidatesImmediatelyWhileRemoteAuthorizationIsPending() throws Exception {
  java.util.concurrent.CountDownLatch started=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.CountDownLatch release=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicReference<Throwable> background=new java.util.concurrent.atomic.AtomicReference<>();
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->{
   started.countDown();
   try{
    if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))
     throw new IOException("REMOTE_TIMEOUT");
   }catch(InterruptedException interrupted){
    Thread.currentThread().interrupt();
    throw new IOException("INTERRUPTED",interrupted);
   }
  });
  Thread request=new Thread(()->{
   try{gate.request(A);background.set(new AssertionError("late permit was granted"));}
   catch(Throwable caught){background.set(caught);}
  });
  request.start();
  assertTrue("remote authorization did not begin",started.await(2,java.util.concurrent.TimeUnit.SECONDS));
  Thread stopper=new Thread(gate::invalidate);
  stopper.start();
  stopper.join(500);
  boolean canceled=!stopper.isAlive();
  release.countDown();
  request.join(3000);stopper.join(3000);
  assertTrue("stop blocked on remote network call",canceled);
  assertFalse("authorization worker failed to finish",request.isAlive());
  assertTrue("late remote success resurrected playback: "+background.get(),
    background.get() instanceof IOException);
  assertEquals("AUTH_SUPERSEDED",background.get().getMessage());
 }
 @Test public void secondAttemptSupersedesInFlightAuthorization() throws Exception {
  java.util.concurrent.CountDownLatch firstStarted=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.CountDownLatch releaseFirst=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicReference<Throwable> oldResult=new java.util.concurrent.atomic.AtomicReference<>();
  FamilyPlaybackLeaseGate gate=new FamilyPlaybackLeaseGate(id->{
   if(A.equals(id)){
    firstStarted.countDown();
    try{if(!releaseFirst.await(5,java.util.concurrent.TimeUnit.SECONDS))
      throw new IOException("REMOTE_TIMEOUT");
    }catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException(e);}
   }
  });
  Thread first=new Thread(()->{
   try{gate.request(A);oldResult.set(new AssertionError("superseded request accepted"));}
   catch(Throwable error){oldResult.set(error);}
  });
  first.start();
  assertTrue(firstStarted.await(2,java.util.concurrent.TimeUnit.SECONDS));
  FamilyPlaybackLeaseGate.Permit second=gate.request(B);
  gate.requireAuthorized(second,B);
  releaseFirst.countDown();
  first.join(3000);
  assertFalse(first.isAlive());
  assertTrue(oldResult.get() instanceof IOException);
  assertEquals("AUTH_SUPERSEDED",oldResult.get().getMessage());
  gate.requireAuthorized(second,B);
 }

}
