const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.join(__dirname, '..', 'node_modules', '@codetrix-studio', 'capacitor-google-auth');
const packageJson = require(path.join(packageRoot, 'package.json'));
if (packageJson.version !== '3.4.0-rc.4') {
  throw new Error(`Unsupported capacitor-google-auth version: ${packageJson.version}`);
}

const sourcePath = path.join(
  packageRoot,
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
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(original, replacement, alreadyApplied) {
  if (source.includes(alreadyApplied)) return;
  if (source.includes(original)) {
    source = source.replace(original, replacement);
  } else {
    throw new Error(`Could not safely apply Android Google Auth patch near: ${original.slice(0, 80)}`);
  }
}

replaceOnce(
  'import android.util.Log;',
  'import android.text.TextUtils;',
  'import android.text.TextUtils;'
);
replaceOnce(
  'import java.net.URL;',
  'import java.net.URL;\nimport java.util.ArrayList;\nimport java.util.List;',
  'import java.util.ArrayList;\nimport java.util.List;'
);
replaceOnce(
  'import android.content.Intent;',
  'import android.app.Activity;\nimport android.content.Intent;',
  'import android.app.Activity;'
);
replaceOnce(
  'import com.getcapacitor.JSObject;',
  'import com.getcapacitor.JSArray;\nimport com.getcapacitor.JSObject;',
  'import com.getcapacitor.JSArray;'
);
replaceOnce(
  'import com.google.android.gms.auth.api.signin.GoogleSignIn;',
  'import com.google.android.gms.auth.api.identity.AuthorizationRequest;\n' +
    'import com.google.android.gms.auth.api.identity.AuthorizationResult;\n' +
    'import com.google.android.gms.auth.api.identity.Identity;\n' +
    'import com.google.android.gms.auth.api.signin.GoogleSignIn;',
  'import com.google.android.gms.auth.api.identity.AuthorizationRequest;'
);
replaceOnce(
  'import java.util.ArrayList;',
  'import java.util.ArrayList;\nimport java.util.Arrays;',
  'import java.util.Arrays;'
);
replaceOnce(
  '  private GoogleSignInClient googleSignInClient;',
  '  private GoogleSignInClient googleSignInClient;\n  private String[] configuredScopes = new String[] {\n' +
    '    "https://www.googleapis.com/auth/userinfo.email",\n' +
    '    "https://www.googleapis.com/auth/userinfo.profile"\n' +
    '  };',
  '  private String[] configuredScopes = new String[] {'
);
const configuredScopesDeclaration =
  '  private String[] configuredScopes = new String[] {\n' +
  '    "https://www.googleapis.com/auth/userinfo.email",\n' +
  '    "https://www.googleapis.com/auth/userinfo.profile"\n' +
  '  };';
while (source.includes(`${configuredScopesDeclaration}\n${configuredScopesDeclaration}`)) {
  source = source.replace(
    `${configuredScopesDeclaration}\n${configuredScopesDeclaration}`,
    configuredScopesDeclaration
  );
}
replaceOnce(
  '  public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {\n',
  '  public void loadSignInClient (String clientId, boolean forceCodeForRefreshToken, String[] scopeArray) {\n' +
    '    configuredScopes = scopeArray;\n',
  '    configuredScopes = scopeArray;'
);
while (source.includes('    configuredScopes = scopeArray;\n    configuredScopes = scopeArray;')) {
  source = source.replace(
    '    configuredScopes = scopeArray;\n    configuredScopes = scopeArray;',
    '    configuredScopes = scopeArray;'
  );
}
replaceOnce(
  '        authentication.put(FIELD_ACCESS_TOKEN, accessTokenObject.get(FIELD_ACCESS_TOKEN));\n' +
    '        authentication.put("refreshToken", "");',
  '        authentication.put(FIELD_ACCESS_TOKEN, accessTokenObject.get(FIELD_ACCESS_TOKEN));\n' +
    '        authentication.put(FIELD_TOKEN_EXPIRES, accessTokenObject.get(FIELD_TOKEN_EXPIRES));\n' +
    '        authentication.put(FIELD_TOKEN_EXPIRES_IN, accessTokenObject.get(FIELD_TOKEN_EXPIRES_IN));\n' +
    '        authentication.put("refreshToken", "");',
  '        authentication.put(FIELD_TOKEN_EXPIRES, accessTokenObject.get(FIELD_TOKEN_EXPIRES));\n' +
    '        authentication.put(FIELD_TOKEN_EXPIRES_IN, accessTokenObject.get(FIELD_TOKEN_EXPIRES_IN));\n' +
    '        authentication.put("refreshToken", "");'
);
replaceOnce(
  'manager.getAuthToken(account, "oauth2:profile email", null, false, null, null)',
  'manager.getAuthToken(account, getOAuthTokenType(), null, false, null, null)',
  'manager.getAuthToken(account, getOAuthTokenType(), null, false, null, null)'
);
const oauthTokenTypeMethodPattern = /\r?\n  private String getOAuthTokenType\(\) \{[\s\S]*?\r?\n  \}/g;
const oauthTokenTypeMethods = source.match(oauthTokenTypeMethodPattern) || [];
if (oauthTokenTypeMethods.length > 1) {
  source = source.replace(oauthTokenTypeMethodPattern, '');
  const verifyTokenMarker = '\n  private JSONObject verifyToken(String authToken) throws IOException, JSONException {';
  if (!source.includes(verifyTokenMarker)) {
    throw new Error('Could not safely normalize duplicate OAuth token helper methods');
  }
  source = source.replace(verifyTokenMarker, `${oauthTokenTypeMethods[0]}${verifyTokenMarker}`);
}
replaceOnce(
  '\n  private JSONObject verifyToken(String authToken) throws IOException, JSONException {',
  '\n  private String getOAuthTokenType() {\n' +
    '    List<String> scopes = new ArrayList<>();\n' +
    '    for (String scope : configuredScopes) {\n' +
    '      if ("openid".equals(scope)) continue;\n' +
    '      if ("email".equals(scope)) {\n' +
    '        scopes.add("https://www.googleapis.com/auth/userinfo.email");\n' +
    '      } else if ("profile".equals(scope)) {\n' +
    '        scopes.add("https://www.googleapis.com/auth/userinfo.profile");\n' +
    '      } else if (!scope.isEmpty()) {\n' +
    '        scopes.add(scope);\n' +
    '      }\n' +
    '    }\n' +
    '    return "oauth2:" + TextUtils.join(" ", scopes);\n' +
    '  }\n' +
    '\n  private JSONObject verifyToken(String authToken) throws IOException, JSONException {',
  '\n  private String getOAuthTokenType() {'
);
const safePickDriveFileCode =
  '  @PluginMethod()\n' +
  '  public void pickDriveFile(PluginCall call) {\n' +
  '    AuthorizationRequest.Builder requestBuilder = AuthorizationRequest.builder()\n' +
  '      .setRequestedScopes(Arrays.asList(new Scope("https://www.googleapis.com/auth/drive.file")))\n' +
  '      .setOptOutIncludingGrantedScopes(true);\n' +
  '    try {\n' +
  '      Class<?> resourceParamClass = Class.forName("com.google.android.gms.auth.api.identity.AuthorizationRequest$ResourceParameter");\n' +
  '      Object pickerTrigger = null;\n' +
  '      Object pickerMimeTypes = null;\n' +
  '      Object[] constants = resourceParamClass.getEnumConstants();\n' +
  '      if (constants != null) {\n' +
  '        for (Object c : constants) {\n' +
  '          String name = c.toString();\n' +
  '          if ("PICKER_OAUTH_TRIGGER".equals(name)) pickerTrigger = c;\n' +
  '          if ("PICKER_MIMETYPES".equals(name)) pickerMimeTypes = c;\n' +
  '        }\n' +
  '      }\n' +
  '      if (pickerTrigger != null) {\n' +
  '        java.lang.reflect.Method addParamMethod = requestBuilder.getClass().getMethod("addResourceParameter", resourceParamClass, String.class);\n' +
  '        addParamMethod.invoke(requestBuilder, pickerTrigger, "true");\n' +
  '        if (pickerMimeTypes != null) {\n' +
  '          addParamMethod.invoke(requestBuilder, pickerMimeTypes, "application/vnd.google-apps.spreadsheet,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");\n' +
  '        }\n' +
  '      }\n' +
  '      if (pickerTrigger == null || pickerMimeTypes == null) throw new IllegalStateException("Google Picker parameters are unavailable.");\n' +
  '      java.lang.reflect.Method setPromptMethod = requestBuilder.getClass().getMethod("setPrompt", int.class);\n' +
  '      setPromptMethod.invoke(requestBuilder, 1);\n' +
  '    } catch (Exception configurationError) {\n' +
  '      call.reject("Không thể cấu hình Google Picker trên Android.", configurationError);\n' +
  '      return;\n' +
  '    }\n' +
  '    AuthorizationRequest request = requestBuilder.build();\n' +
  '\n' +
  '    Identity.getAuthorizationClient(getActivity()).authorize(request)\n' +
  '      .addOnSuccessListener(getActivity(), authorizationResult -> {\n' +
  '        if (authorizationResult.hasResolution()) {\n' +
  '          Intent intent = new Intent(getContext(), DrivePickerActivity.class);\n' +
  '          intent.putExtra(DrivePickerActivity.EXTRA_PENDING_INTENT, authorizationResult.getPendingIntent());\n' +
  '          startActivityForResult(call, intent, "pickDriveFileResult");\n' +
  '        } else {\n' +
  '          resolveDrivePickerResult(call, authorizationResult);\n' +
  '        }\n' +
  '      })\n' +
  '      .addOnFailureListener(getActivity(), error -> call.reject("Không thể mở Google Picker.", error));\n' +
  '  }\n' +
  '\n' +
  '  @ActivityCallback\n' +
  '  protected void pickDriveFileResult(PluginCall call, ActivityResult result) {\n' +
  '    if (call == null) return;\n' +
  '    Intent data = result.getData();\n' +
  '    if (result.getResultCode() != Activity.RESULT_OK) {\n' +
  '      String error = data == null ? null : data.getStringExtra(DrivePickerActivity.EXTRA_ERROR);\n' +
  '      if (error != null) call.reject(error);\n' +
  '      else resolveDrivePickerResult(call, null);\n' +
  '      return;\n' +
  '    }\n' +
  '    if (data == null) {\n' +
  '      call.reject("Không nhận được dữ liệu phản hồi từ Google Picker.");\n' +
  '      return;\n' +
  '    }\n' +
  '    try {\n' +
  '      AuthorizationResult authorizationResult = Identity.getAuthorizationClient(getActivity())\n' +
  '        .getAuthorizationResultFromIntent(data);\n' +
  '      resolveDrivePickerResult(call, authorizationResult);\n' +
  '    } catch (Exception error) {\n' +
  '      call.reject("Không thể hoàn tất xác thực Google Picker.", error);\n' +
  '    }\n' +
  '  }\n' +
  '\n' +
  '  private void resolveDrivePickerResult(PluginCall call, AuthorizationResult authorizationResult) {\n' +
  '    JSArray fileIds = new JSArray();\n' +
  '    String accessToken = null;\n' +
  '    if (authorizationResult != null) {\n' +
  '      accessToken = authorizationResult.getAccessToken();\n' +
  '      Bundle tokenParams = null;\n' +
  '      try {\n' +
  '        java.lang.reflect.Method getTokenParamsMethod = authorizationResult.getClass().getMethod("getTokenResponseParams");\n' +
  '        tokenParams = (Bundle) getTokenParamsMethod.invoke(authorizationResult);\n' +
  '      } catch (Exception paramsError) {\n' +
  '        call.reject("Không thể đọc kết quả cấp quyền của Google Picker.", paramsError);\n' +
  '        return;\n' +
  '      }\n' +
  '      if (accessToken == null && tokenParams != null) accessToken = tokenParams.getString("access_token");\n' +
  '      String pickedIds = tokenParams == null ? null : tokenParams.getString("picked_file_ids");\n' +
  '      if (pickedIds != null) {\n' +
  '        for (String fileId : pickedIds.split(",")) {\n' +
  '          String trimmed = fileId.trim();\n' +
  '          if (!trimmed.isEmpty()) {\n' +
  '            fileIds.put(trimmed);\n' +
  '          }\n' +
  '        }\n' +
  '      }\n' +
  '    }\n' +
  '    JSObject response = new JSObject();\n' +
  '    response.put("accessToken", accessToken);\n' +
  '    response.put("fileIds", fileIds);\n' +
  '    call.resolve(response);\n' +
  '  }\n\n';

const pickMethodMarker = '  @PluginMethod()\n  public void pickDriveFile(PluginCall call) {';
const signInMarker = '  @PluginMethod()\n  public void signIn(PluginCall call) {';

if (source.includes(pickMethodMarker)) {
  const startIndex = source.indexOf(pickMethodMarker);
  const endIndex = source.indexOf(signInMarker);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    source = source.slice(0, startIndex) + safePickDriveFileCode + source.slice(endIndex);
  } else {
    throw new Error('Could not find boundaries of pickDriveFile method');
  }
} else {
  replaceOnce(
    signInMarker,
    safePickDriveFileCode + signInMarker,
    '  public void pickDriveFile(PluginCall call) {'
  );
}

const tokenLog = '    Log.d("AuthenticatedBackend", "token: " + authToken + ", verification: " + stringResponse);\n';
if (source.includes(tokenLog)) source = source.replace(tokenLog, '');

fs.writeFileSync(sourcePath, source);

const activitySource = path.join(__dirname, 'DrivePickerActivity.java');
const activityTarget = path.join(path.dirname(sourcePath), 'DrivePickerActivity.java');
fs.copyFileSync(activitySource, activityTarget);

const manifestPath = path.join(packageRoot, 'android', 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const activityEntry = '    <activity android:name="com.codetrixstudio.capacitor.GoogleAuth.DrivePickerActivity" android:exported="false" android:theme="@android:style/Theme.Translucent.NoTitleBar" />';
if (!manifest.includes('DrivePickerActivity')) {
  if (manifest.includes('</application>')) {
    manifest = manifest.replace('</application>', `${activityEntry}\n  </application>`);
  } else {
    manifest = manifest.replace(
      '</manifest>',
      `  <application>\n${activityEntry}\n  </application>\n</manifest>`
    );
  }
  fs.writeFileSync(manifestPath, manifest);
}

const gradlePath = path.join(packageRoot, 'android', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(
  /implementation\s+['"]com\.google\.android\.gms:play-services-auth:[^'"]+['"]/,
  "implementation 'com.google.android.gms:play-services-auth:21.6.0'"
);
fs.writeFileSync(gradlePath, gradle);
