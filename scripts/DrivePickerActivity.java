package com.codetrixstudio.capacitor.GoogleAuth;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;

public class DrivePickerActivity extends Activity {
  public static final String EXTRA_PENDING_INTENT = "drivePickerPendingIntent";
  public static final String EXTRA_ERROR = "drivePickerError";
  private static final int AUTHORIZATION_REQUEST_CODE = 9017;

  @Override
  @SuppressWarnings("deprecation")
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Intent sourceIntent = getIntent();
    PendingIntent pendingIntent = sourceIntent != null ? sourceIntent.getParcelableExtra(EXTRA_PENDING_INTENT) : null;
    if (pendingIntent == null) {
      setError("Không nhận được yêu cầu mở Google Picker.");
      finish();
      return;
    }
    try {
      startIntentSenderForResult(
        pendingIntent.getIntentSender(),
        AUTHORIZATION_REQUEST_CODE,
        null,
        0,
        0,
        0
      );
    } catch (IntentSender.SendIntentException exception) {
      setError(exception.getMessage());
      finish();
    }
  }

  private void setError(String message) {
    Intent result = new Intent();
    result.putExtra(EXTRA_ERROR, message == null ? "Không thể mở Google Picker." : message);
    setResult(Activity.RESULT_CANCELED, result);
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != AUTHORIZATION_REQUEST_CODE) return;
    setResult(resultCode, data);
    finish();
  }
}
