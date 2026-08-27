package com.surakshasetu.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
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
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "BLE_SOS_Relay";
    private static final UUID SERVICE_UUID = UUID.fromString("505b9110-3fa1-4e6a-913a-c4345b080001");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("505b9110-3fa1-4e6a-913a-c4345b080002");
    private static final int MANUFACTURER_ID = 0xFFFF; // Using reserved for testing
    private static final int REQUEST_PERMISSIONS = 121;
    
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private String serverUrl = "https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay";
    private final Set<String> processedSOSPackets = Collections.synchronizedSet(new HashSet<>());
    private final Set<String> pendingConnections = Collections.synchronizedSet(new HashSet<>());

    // Inner Capacitor plugin so JS can call window.Capacitor.Plugins.BleSosRelay.advertiseSOS()
    @CapacitorPlugin(name = "BleSosRelay")
    public class BleSosRelayPlugin extends Plugin {
        @PluginMethod
        public void setServerUrl(PluginCall call) {
            String url = call.getString("url");
            if (url != null && !url.isEmpty()) {
                serverUrl = url;
                Log.i(TAG, "Relay Server URL updated: " + serverUrl);
            }
            call.resolve();
        }

        @PluginMethod
        public void advertiseSOS(PluginCall call) {
            String packet = call.getString("packet", "");
            if (packet != null && !packet.isEmpty()) {
                Log.i(TAG, "JS requested SOS advertisement (Legacy). Packet: " + packet);
                advertiseSOSPacket(packet);
            }
            call.resolve();
        }

        @PluginMethod
        public void advertiseSOSBinary(PluginCall call) {
            String touristId = call.getString("touristId");
            Double lat = call.getDouble("latitude");
            Double lng = call.getDouble("longitude");
            Integer battery = call.getInt("battery");

            if (touristId != null && lat != null && lng != null) {
            try {
                UUID uuid = UUID.fromString(touristId);
                ByteBuffer buffer = ByteBuffer.allocate(25);
                buffer.order(ByteOrder.BIG_ENDIAN);
                buffer.putLong(uuid.getMostSignificantBits());
                buffer.putLong(uuid.getLeastSignificantBits());
                buffer.putFloat(lat.floatValue());
                buffer.putFloat(lng.floatValue());
                buffer.put((byte) (battery != null ? battery.intValue() : -1));
                
                byte[] data = buffer.array();
                advertiseBinaryData(data);
                Log.i(TAG, "BLE SOS Binary advertising started for " + touristId);
                call.resolve();
            } catch (Exception e) {
                    call.reject("Invalid data: " + e.getMessage());
                }
            } else {
                call.reject("Missing required fields");
            }
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

    @Override
    public void onResume() {
        super.onResume();
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
        List<ScanFilter> filters = new ArrayList<>();
        
        // Filter 1: Android Manufacturer Data (Binary Format)
        filters.add(new ScanFilter.Builder().setManufacturerData(MANUFACTURER_ID, new byte[]{}).build());
        
        // Filter 2: iOS Service UUID (Characteristic-based Format)
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID)).build());

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        scanner.startScan(filters, settings, scanCallback);
        Log.i(TAG, "BLE Scanning started for Manufacturer ID and Service UUID");
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            super.onScanResult(callbackType, result);
            if (result.getScanRecord() == null) return;
            
            // 1. Try Binary Format (Manufacturer Data - Android)
            byte[] manufacturerData = result.getScanRecord().getManufacturerSpecificData(MANUFACTURER_ID);
            if (manufacturerData != null && manufacturerData.length >= 24) {
                parseBinaryPayload(manufacturerData);
                return;
            }

            // 2. Try iOS Service UUID (Connection-based)
            List<ParcelUuid> services = result.getScanRecord().getServiceUuids();
            if (services != null) {
                for (ParcelUuid uuid : services) {
                    if (uuid.getUuid().equals(SERVICE_UUID)) {
                        String address = result.getDevice().getAddress();
                        if (!pendingConnections.contains(address)) {
                            pendingConnections.add(address);
                            result.getDevice().connectGatt(MainActivity.this, false, gattCallback);
                        }
                    }
                }
            }

            // Fallback: Legacy JSON (Service Data)
            byte[] payload = result.getScanRecord().getServiceData(new ParcelUuid(SERVICE_UUID));
            if (payload != null) {
                String packet = new String(payload, StandardCharsets.UTF_8);
                handleSOSPacket(packet);
            }
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                gatt.discoverServices();
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                pendingConnections.remove(gatt.getDevice().getAddress());
                gatt.close();
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                BluetoothGattService service = gatt.getService(SERVICE_UUID);
                if (service != null) {
                    BluetoothGattCharacteristic characteristic = service.getCharacteristic(CHARACTERISTIC_UUID);
                    if (characteristic != null) {
                        gatt.readCharacteristic(characteristic);
                    }
                }
            }
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.getUuid().equals(CHARACTERISTIC_UUID)) {
                byte[] data = characteristic.getValue();
                if (data != null) {
                    if (data.length >= 24) {
                        parseBinaryPayload(data);
                    } else {
                        String packet = new String(data, StandardCharsets.UTF_8);
                        handleSOSPacket(packet);
                    }
                }
            }
            gatt.disconnect();
        }
    };

    private void parseBinaryPayload(byte[] data) {
        try {
            ByteBuffer buffer = ByteBuffer.wrap(data);
            buffer.order(ByteOrder.BIG_ENDIAN);
            long mostSigBits = buffer.getLong();
            long leastSigBits = buffer.getLong();
            float lat = buffer.getFloat();
            float lng = buffer.getFloat();
            int battery = (data.length > 24) ? buffer.get() : -1;
            
            UUID touristId = new UUID(mostSigBits, leastSigBits);
            String jsonPacket = String.format(Locale.US,
                "{\"tourist_id\":\"%s\",\"latitude\":%f,\"longitude\":%f,\"battery_status\":%d}",
                touristId, lat, lng, battery
            );
            handleSOSPacket(jsonPacket);
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse binary SOS: " + e.getMessage());
        }
    }

    private void advertiseBinaryData(byte[] data) {
        if (advertiser == null) return;

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .build();

        AdvertiseData advertiseData = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addManufacturerData(MANUFACTURER_ID, data)
            .build();

        advertiser.startAdvertising(settings, advertiseData, new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings settingsInEffect) {
                super.onStartSuccess(settingsInEffect);
                Log.i(TAG, "BLE SOS Binary advertising started successfully.");
            }

            @Override
            public void onStartFailure(int errorCode) {
                super.onStartFailure(errorCode);
                Log.e(TAG, "BLE SOS Binary advertising failed: " + errorCode);
            }
        });
    }

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
            URL url = new URL(serverUrl);
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
