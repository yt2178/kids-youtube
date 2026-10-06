// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;
import android.content.Context;
import android.security.keystore.*;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
/** Credentials stay encrypted on the parent's device; never in the child APK. */
final class TokenVault {
    private final Context context;
    private static final String ALIAS="KidsParentGithub";
    TokenVault(Context context){this.context=context.getApplicationContext();}
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(!store.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (javax.crypto.SecretKey)store.getKey(ALIAS,null);
    }
    void save(String token) throws Exception {
        if(token==null || !token.matches("(github_pat_|gh[pou]_)\\S{20,1000}"))throw new IllegalArgumentException("INVALID_TOKEN");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        String value=Base64.getEncoder().encodeToString(cipher.getIV())+"."
                +Base64.getEncoder().encodeToString(cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        if(!context.getSharedPreferences("parent-credentials",0).edit().putString("encrypted",value).commit())
            throw new IllegalStateException("STORAGE_FAILED");
    }
    String read() {
        try {
            String stored=context.getSharedPreferences("parent-credentials",0).getString("encrypted",null);
            if(stored==null)return null;
            String[] parts=stored.split("\\.",2);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.getDecoder().decode(parts[0])));
            return new String(cipher.doFinal(Base64.getDecoder().decode(parts[1])),java.nio.charset.StandardCharsets.UTF_8);
        }catch(Exception ignored){return null;}
    }
    void clear(){context.getSharedPreferences("parent-credentials",0).edit().clear().apply();}
}

