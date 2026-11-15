package app.lumio.camera;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Lumio Android app: a WebView around the Lumio website, plus what a camera app needs that a
 * plain WebView lacks: camera/microphone permission for the page, saving photos and videos to
 * the gallery, and sharing them (the page calls window.LumioAndroid for these).
 */
public class MainActivity extends Activity {

    private static final String SITE = "https://lumio-app-sand.vercel.app/";
    private static final String[] SITE_HOSTS = {"lumio-app-sand.vercel.app"};
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int MEDIA_PERMISSION_REQUEST = 1002;
    private static final int STORAGE_PERMISSION_REQUEST = 1003;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.BLACK);
        w.setNavigationBarColor(Color.BLACK);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " LumioApp/1");   // the page hides its "download the app" box
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new Bridge(), "LumioAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // the page asks for the camera / microphone (getUserMedia)
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    List<String> need = new ArrayList<>();
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    }
                    if (need.isEmpty()) { grantAllowed(request); return; }
                    if (pendingWebPermission != null) pendingWebPermission.deny();
                    pendingWebPermission = request;
                    requestPermissions(need.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (url.startsWith("http")) openExternal(Uri.parse(url));
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(startUrl(getIntent()));
        }
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isSite(data)) return data.toString();
        return SITE;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isSite(data)) webView.loadUrl(data.toString());
    }

    private boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void grantAllowed(PermissionRequest request) {
        List<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
            else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
        }
        if (ok.isEmpty()) request.deny();
        else request.grant(ok.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == MEDIA_PERMISSION_REQUEST && pendingWebPermission != null) {
            grantAllowed(pendingWebPermission);
            pendingWebPermission = null;
            return;
        }
        if (requestCode == STORAGE_PERMISSION_REQUEST) {
            toast(results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED
                    ? "اب دوبارہ «محفوظ» دبائیں" : "گیلری میں محفوظ کرنے کی اجازت نہیں ملی");
        }
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    private boolean isSite(Uri uri) {
        String scheme = uri.getScheme(), host = uri.getHost();
        if (!("https".equals(scheme) || "http".equals(scheme)) || host == null) return false;
        for (String site : SITE_HOSTS) if (host.equals(site) || host.endsWith("." + site)) return true;
        return false;
    }

    // Lumio pages stay in the app; WhatsApp, other sites, mail etc. open outside
    private boolean handleUrl(Uri uri) {
        if (isSite(uri)) return false;
        openExternal(uri);
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void toast(final String text) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
    }

    /** Writes a photo/video into the phone's gallery (Pictures/Lumio or Movies/Lumio). */
    private Uri saveToGallery(byte[] bytes, String name, String mime) throws Exception {
        boolean video = mime != null && mime.startsWith("video/");
        ContentResolver cr = getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        Uri collection;
        if (Build.VERSION.SDK_INT >= 29) {
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/Lumio");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            collection = video ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } else {
            collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        }
        Uri item = cr.insert(collection, v);
        if (item == null) throw new Exception("insert failed");
        try (OutputStream out = cr.openOutputStream(item)) {
            if (out == null) throw new Exception("no stream");
            out.write(bytes);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(item, done, null, null);
        }
        return item;
    }

    private boolean storageReady() {
        if (Build.VERSION.SDK_INT >= 29 || has(Manifest.permission.WRITE_EXTERNAL_STORAGE)) return true;
        runOnUiThread(() -> requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, STORAGE_PERMISSION_REQUEST));
        return false;
    }

    /** Called from the page as window.LumioAndroid.* */
    private class Bridge {
        @JavascriptInterface
        public boolean saveFile(String base64, String name, String mime) {
            if (!storageReady()) return false;
            try {
                saveToGallery(Base64.decode(base64, Base64.DEFAULT), name, mime);
                return true;
            } catch (Exception e) {
                toast("محفوظ نہیں ہو سکی");
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareFile(String base64, String name, String mime, String text) {
            if (!storageReady()) return false;
            try {
                Uri uri = saveToGallery(Base64.decode(base64, Base64.DEFAULT), name, mime);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send, "Lumio"));
                return true;
            } catch (Exception e) {
                toast("شیئر نہیں ہو سکی");
                return false;
            }
        }

        @JavascriptInterface
        public void shareText(String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(send, "Lumio"));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            MainActivity.this.openExternal(Uri.parse(url));
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    // Back: first the page's own back (closes editor, chat, etc.), then leave the app
    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
