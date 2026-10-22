// SPDX-License-Identifier: GPL-3.0-or-later
package il.kidsyoutube;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Android Keystore-backed storage exclusively for the family pilot refresh token. */
final class FamilySessionStore {
    private static final String KEY_ALIAS="kids_family_pilot_refresh_v1";
    private static final String PREFS="family_pilot_secure_v1";
    private static final String REFRESH="refresh_ciphertext";
    private final SharedPreferences preferences;
    FamilySessionStore(Context context){
        preferences=context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }
    private SecretKey secret() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry stored=store.getEntry(KEY_ALIAS,null);
        if(stored instanceof KeyStore.SecretKeyEntry)
            return ((KeyStore.SecretKeyEntry)stored).getSecretKey();
        KeyGenerator keygen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        keygen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setKeySize(256).build());
        return keygen.generateKey();
    }
    void save(String refreshToken) throws Exception {
        if(refreshToken==null||refreshToken.length()<20||refreshToken.length()>4096)
            throw new IllegalArgumentException("INVALID_REFRESH_TOKEN");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,secret());
        byte[] iv=cipher.getIV();
        byte[] ciphertext=cipher.doFinal(refreshToken.getBytes(StandardCharsets.UTF_8));
        byte[] stored=new byte[1+iv.length+ciphertext.length];
        stored[0]=(byte)iv.length;
        System.arraycopy(iv,0,stored,1,iv.length);
        System.arraycopy(ciphertext,0,stored,1+iv.length,ciphertext.length);
        if(!preferences.edit().putString(REFRESH,android.util.Base64.encodeToString(stored,android.util.Base64.NO_WRAP)).commit())
            throw new IllegalStateException("REFRESH_PERSIST_FAILED");
    }
    String load() {
        String encoded=preferences.getString(REFRESH,null);
        if(encoded==null)return null;
        try{
            byte[] stored=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);
            if(stored.length<30)throw new IllegalArgumentException("INVALID_CIPHERTEXT");
            int ivLength=stored[0]&255;
            if(ivLength!=12 || stored.length<=1+ivLength+16)throw new IllegalArgumentException("INVALID_IV");
            byte[] iv=new byte[ivLength];
            System.arraycopy(stored,1,iv,0,iv.length);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,secret(),new GCMParameterSpec(128,iv));
            byte[] plain=cipher.doFinal(stored,1+ivLength,stored.length-1-ivLength);
            return new String(plain,StandardCharsets.UTF_8);
        }catch(Exception error){
            clear(); // Lost/invalidated Keystore key => never silently bypass authentication.
            return null;
        }
    }
    void clear(){preferences.edit().remove(REFRESH).commit();}
}
