import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageDirectory = dirname(dirname(dirname(require.resolve('@codetrix-studio/capacitor-google-auth'))));
const sourcePath = join(
  packageDirectory,
  'android',
  'src',
  'main',
  'java',
  'com',
  'codetrixstudio',
  'capacitor',
  'GoogleAuth',
  'GoogleAuth.java'
);

let source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

function replaceExactlyOnce(original, replacement, patchedMarker) {
  if (source.includes(patchedMarker)) return;
  const firstIndex = source.indexOf(original);
  if (firstIndex < 0 && replacement === '') return;
  if (firstIndex < 0 || source.indexOf(original, firstIndex + original.length) >= 0) {
    throw new Error(`Cannot apply Google Auth Android patch; expected one occurrence of:\n${original}`);
  }
  source = source.replace(original, replacement);
}

replaceExactlyOnce(
  'import android.util.Log;',
  'import android.text.TextUtils;',
  'import android.text.TextUtils;'
);
replaceExactlyOnce(
  'import java.io.InputStreamReader;',
  'import java.io.InputStreamReader;\nimport java.util.Arrays;',
  'import java.util.Arrays;'
);
replaceExactlyOnce(
  '  private GoogleSignInClient googleSignInClient;',
  '  private GoogleSignInClient googleSignInClient;\n  private String[] requestedScopes;',
  'private String[] requestedScopes;'
);
replaceExactlyOnce(
  '  public static final int KAssumeStaleTokenSec = 60;',
  '  public static final int KAssumeStaleTokenSec = 300;',
  'public static final int KAssumeStaleTokenSec = 300;'
);
replaceExactlyOnce(
  '  public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {\n',
  '  public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {\n    this.requestedScopes = scopeArray;\n',
  'this.requestedScopes = scopeArray;'
);
replaceExactlyOnce(
  '        authentication.put("refreshToken", "");\n        call.resolve(authentication);',
  '        authentication.put("refreshToken", "");\n' +
    '        authentication.put(FIELD_TOKEN_EXPIRES, accessTokenObject.get(FIELD_TOKEN_EXPIRES));\n' +
    '        authentication.put(FIELD_TOKEN_EXPIRES_IN, accessTokenObject.get(FIELD_TOKEN_EXPIRES_IN));\n' +
    '        call.resolve(authentication);',
  'authentication.put(FIELD_TOKEN_EXPIRES, accessTokenObject.get(FIELD_TOKEN_EXPIRES));'
);
replaceExactlyOnce(
  '    AccountManagerFuture<Bundle> future = manager.getAuthToken(account, "oauth2:profile email", null, false, null, null);',
  '    AccountManagerFuture<Bundle> future = manager.getAuthToken(account, "oauth2:" + TextUtils.join(" ", requestedScopes), null, false, null, null);',
  'TextUtils.join(" ", requestedScopes)'
);
replaceExactlyOnce(
  '    Log.d("AuthenticatedBackend", "token: " + authToken + ", verification: " + stringResponse);\n',
  '',
  'String grantedScopes = jsonResponse.optString("scope", "");'
);
replaceExactlyOnce(
  '    JSONObject jsonResponse = new JSONObject(stringResponse);\n',
  '    JSONObject jsonResponse = new JSONObject(stringResponse);\n' +
    '    String driveScope = "https://www.googleapis.com/auth/drive.file";\n' +
    '    String grantedScopes = jsonResponse.optString("scope", "");\n' +
    '    if (Arrays.asList(requestedScopes).contains(driveScope) &&\n' +
    '      !Arrays.asList(grantedScopes.split(" ")).contains(driveScope)) {\n' +
    '      throw new IOException("Google did not grant the requested Drive scope.");\n' +
    '    }\n',
  'String grantedScopes = jsonResponse.optString("scope", "");'
);

writeFileSync(sourcePath, source, 'utf8');
