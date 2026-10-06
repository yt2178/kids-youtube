// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.InterruptedIOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.Call;

/** Each bridge task cancels only its own network calls. */
final class RequestScope implements AutoCloseable {
    static final ThreadLocal<RequestScope> CURRENT = new ThreadLocal<>();
    private final Set<Call> calls = ConcurrentHashMap.newKeySet();
    final long deadline;
    volatile boolean cancelled;
    RequestScope(long timeoutMs) {deadline=System.currentTimeMillis()+timeoutMs;}
    void enter() {CURRENT.set(this);}
    void check() throws InterruptedIOException {
        if (cancelled || Thread.currentThread().isInterrupted() || System.currentTimeMillis()>=deadline)
            throw new InterruptedIOException("TIMEOUT");
    }
    void add(Call call) throws InterruptedIOException {check(); calls.add(call); if(cancelled)call.cancel();}
    void remove(Call call) {calls.remove(call);}
    void cancel() {cancelled=true;for(Call call:calls)call.cancel();}
    @Override public void close() {cancel();CURRENT.remove();}
}
