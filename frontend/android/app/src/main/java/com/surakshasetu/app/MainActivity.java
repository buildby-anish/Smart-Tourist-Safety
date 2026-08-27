package com.surakshasetu.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelUuid;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "BLE_SOS_Relay";
    private static final UUID SERVICE_UUID = UUID.fromString("505b9110-3fa1-4e6a-913a-c4345b080001");
    private static final int REQUEST_PERMISSIONS = 121;
    
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private final Set<String> processedSOSPackets = Collections.synchronizedSet(new HashSet<>());

    // Inner Capacitor plugin so JS can call window.Capacitor.Plugins.BleSosRelay.advertiseSOS()
    @CapacitorPlugin(name = "BleSosRelay")
    public class BleSosRelayPlugin extends Plugin {
        @PluginMethod
        public void advertiseSOS(PluginCall call) {
            String packet = call.getString("packet", "");
            if (packet != null && !packet.isEmpty()) {
                advertiseSOSPacket(packet);
            }
            call.resolve();
        }
    }



    private void checkAndRequestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> permissions = new java.util.ArrayList<>();
            
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.ACCESS_FINE_LOCATION);
            }
            if (checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(android.Manifest.permission.ACCESS_COARSE_LOCATION);
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(android.Manifest.permission.BLUETOOTH_SCAN);
                }
                if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(android.Manifest.permission.BLUETOOTH_ADVERTISE);
                }
                if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    permissions.add(android.Manifest.permission.BLUETOOTH_CONNECT);
                }
            }
            
            if (!permissions.isEmpty()) {
                requestPermissions(permissions.toArray(new String[0]), REQUEST_PERMISSIONS);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_PERMISSIONS) {
            setupBLERelay();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BleSosRelayPlugin.class);
        super.onCreate(savedInstanceState);
        checkAndRequestPermissions();
        setupBLERelay();
    }

    private void setupBLERelay() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (checkSelfPermission(android.Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED ||
                    checkSelfPermission(android.Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }
        }
        try {
            BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            if (manager == null) return;
            BluetoothAdapter adapter = manager.getAdapter();
            if (adapter == null || !adapter.isEnabled()) return;

            advertiser = adapter.getBluetoothLeAdvertiser();
            scanner = adapter.getBluetoothLeScanner();

            if (scanner != null) {
                startScanning();
            }
        } catch (Exception e) {
            Log.e(TAG, "BLE Setup error: " + e.getMessage());
        }
    }

    private void startScanning() {
        ScanFilter filter = new ScanFilter.Builder()
            .setServiceUuid(new ParcelUuid(SERVICE_UUID))
            .build();

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        scanner.startScan(Collections.singletonList(filter), settings, scanCallback);
        Log.i(TAG, "BLE Scanning started for Service UUID: " + SERVICE_UUID);
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            super.onScanResult(callbackType, result);
            byte[] payload = result.getScanRecord() != null ? result.getScanRecord().getServiceData(new ParcelUuid(SERVICE_UUID)) : null;
            if (payload != null) {
                String packet = new String(payload, StandardCharsets.UTF_8);
                handleSOSPacket(packet);
            }
        }
    };

    private void handleSOSPacket(final String packet) {
        if (processedSOSPackets.contains(packet)) return;
        processedSOSPackets.add(packet);
        Log.i(TAG, "New SOS Packet received via BLE: " + packet);

        new Thread(new Runnable() {
            @Override
            public void run() {
                if (relayToServer(packet)) {
                    Log.i(TAG, "SOS packet relayed to backend successfully.");
                } else {
                    Log.w(TAG, "Failed to relay to backend, starting BLE re-advertisement...");
                    advertiseSOSPacket(packet);
                }
            }
        }).start();
    }

    private void advertiseSOSPacket(String packet) {
        if (advertiser == null) return;

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build();

        byte[] payload = packet.getBytes(StandardCharsets.UTF_8);
        AdvertiseData data = new AdvertiseData.Builder()
            .addServiceUuid(new ParcelUuid(SERVICE_UUID))
            .addServiceData(new ParcelUuid(SERVICE_UUID), payload)
            .build();

        advertiser.startAdvertising(settings, data, new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                super.onStartSuccess(settingsInEffect);
                Log.i(TAG, "BLE SOS advertising started successfully.");
            }

            @Override
            public void onStartFailure(int errorCode) {
                super.onStartFailure(errorCode);
                Log.e(TAG, "BLE SOS advertising failed: " + errorCode);
            }
        });
    }

    private boolean relayToServer(String packet) {
        try {
            URL url = new URL("https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            
            String jsonInputString = "{\"payload\":\"" + packet + "\"}";
            byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
            conn.getOutputStream().write(input, 0, input.length);

            int code = conn.getResponseCode();
            return (code == 200 || code == 201);
        } catch (Exception e) {
            Log.w(TAG, "Internet upload failed: " + e.getMessage());
            return false;
        }
    }
}
