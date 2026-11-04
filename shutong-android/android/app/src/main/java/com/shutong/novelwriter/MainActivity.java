package com.shutong.novelwriter;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * 返回键交给 Web 层处理。
 *
 * Capacitor 默认不接管返回键，系统会直接 finish() 掉 Activity —— 表现就是
 * "按返回键直接退出 App"。这里用 OnBackPressedDispatcher 把事件转给
 * window.__wbBack()：Web 层按优先级（弹层 → 沉浸 → 悬浮窗 → 上一页）逐级消费，
 * 返回 false 表示已经停在书房根页面，这时才退到后台（moveTaskToBack，不杀进程）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                        "(function(){try{return window.__wbBack?window.__wbBack()===true:false}catch(e){return false}})()",
                        value -> {
                            if (!"true".equals(value)) {
                                moveTaskToBack(true);
                            }
                        });
            }
        });
    }
}
