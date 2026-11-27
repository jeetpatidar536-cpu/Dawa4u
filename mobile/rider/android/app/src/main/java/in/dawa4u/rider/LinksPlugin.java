package in.dawa4u.rider;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Links the web page can't open itself go to the phone's own apps:
 * UPI apps (upi://pay), the dialer (tel:), WhatsApp, maps, and Android "intent://" links.
 * Normal web links are left to Capacitor.
 */
@CapacitorPlugin(name = "Dawa4uLinks")
public class LinksPlugin extends Plugin {

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme();
        if (scheme == null) {
            return null;
        }
        scheme = scheme.toLowerCase();
        if (scheme.equals("http") || scheme.equals("https") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("about") || scheme.equals("file") || scheme.equals("javascript")) {
            return null;
        }
        if (scheme.equals("intent")) {
            Intent intent = null;
            try {
                intent = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
                getActivity().startActivity(intent);
            } catch (Exception e) {
                String fallback = intent != null ? intent.getStringExtra("browser_fallback_url") : null;
                if (fallback != null && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
                    getBridge().getWebView().loadUrl(fallback);
                }
            }
            return true;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            // No app on this phone can open it (for example no UPI app installed): stay on the page.
        }
        return true;
    }
}
