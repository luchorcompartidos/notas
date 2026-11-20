package io.github.luchorcompartidos.notas;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Widget "Nota rápida": nueva nota, nueva lista con casillas y buscar. */
public class NotaRapidaWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_nota_rapida);
            views.setOnClickPendingIntent(R.id.widget_nueva, intent(context, IntentBridgePlugin.ACTION_NOTA, 1));
            views.setOnClickPendingIntent(R.id.widget_lista, intent(context, IntentBridgePlugin.ACTION_LISTA, 2));
            views.setOnClickPendingIntent(R.id.widget_buscar, intent(context, IntentBridgePlugin.ACTION_BUSCAR, 3));
            manager.updateAppWidget(id, views);
        }
    }

    private static PendingIntent intent(Context context, String action, int code) {
        Intent i = new Intent(context, MainActivity.class);
        i.setAction(action);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
