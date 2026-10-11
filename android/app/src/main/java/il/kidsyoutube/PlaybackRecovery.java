// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import java.io.IOException;
import java.net.*;
import java.util.concurrent.Callable;

/**
 * A bounded, user-initiated playback-preparation recovery. Each attempt calls
 * NativeApi.playback(), including fresh grants before AND after NewPipe.
 *
 * No retry for explicit denial, invalid grants, TLS certificates, CAPTCHA,
 * rate limits, or cancellation. Never used for Media3 stream transfers.
 */
final class PlaybackRecovery {
    private PlaybackRecovery(){}
    interface RetryNotice {void onRetry(String category);}

    static boolean transientFailure(Throwable failure){
        // Classify the actual exception chain, not a generic UI NETWORK_ERROR.
        boolean transientError=false;
        for(Throwable cause=failure;cause!=null;cause=cause.getCause()){
            // Certificate/TLS errors veto every other classification, even if a
            // wrapper supplies a misleading temporary-network message.
            if(cause instanceof javax.net.ssl.SSLException)return false;
            if(cause instanceof UnknownHostException
                    || cause instanceof ConnectException
                    || cause instanceof NoRouteToHostException
                    || cause instanceof SocketTimeoutException
                    || cause instanceof SocketException)transientError=true;
            if(cause instanceof IOException){
                String reason=cause.getMessage();
                if("AUTH_CHANGED_RETRY".equals(reason)||"AUTH_SUPERSEDED".equals(reason))
                    transientError=true;
            }
        }
        return transientError;
    }

    static <T> T run(RequestScope scope,Callable<T> operation,RetryNotice status) throws Exception{
        for(int attempt=1;attempt<=2;attempt++){
            scope.check();
            try {
                T result=operation.call();
                scope.check();
                return result;
            }catch(Exception failure){
                scope.check(); // A cancelled playback may NEVER retry or commit.
                if(attempt==2 || !transientFailure(failure)
                        || scope.deadline-System.currentTimeMillis()<20000)throw failure;
                if(status!=null)status.onRetry(NativeApi.errorCode(failure));
                // A little time for a transient route failure to clear. Do not
                // repeat instantly against the same resolver negative result.
                try{Thread.sleep(1400);}
                catch(InterruptedException interrupted){
                    Thread.currentThread().interrupt();
                    scope.check();
                    throw new java.io.InterruptedIOException("TIMEOUT");
                }
                scope.check();
            }
        }
        throw new IOException("PLAYBACK_PREPARATION_UNAVAILABLE");
    }
}
