package com.surakshasetu.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
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
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelUuid;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

import java.io.OutputStream;
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
    private static final String TAG = "SosMesh";
    
    // UUIDs for GATT Server / Client Handshake
    private static final UUID SERVICE_UUID = UUID.fromString("505b9110-3fa1-4e6a-913a-c4345b080001");
    private static final UUID SERVICE_UUID_16 = UUID.fromString("00009110-0000-1000-8000-00805f9b34fb");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("505b9110-3fa1-4e6a-913a-c4345b080002");
    
    private static final int REQUEST_PERMISSIONS = 121;
    
    private BluetoothLeAdvertiser advertiser;
    private BluetoothLeScanner scanner;
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic meshCharacteristic;
    
    private boolean isScanning = false;
    private boolean isAdvertising = false;
    private byte[] activePacketData = null;
    
    private android.os.Handler handler = new android.os.Handler();
    private String serverUrl = "https://smart-tourist-safety-production.up.railway.app/api/v1/sos/relay";
    
    private final Set<UUID> processedSosIds = Collections.synchronizedSet(new HashSet<>());
    private final Set<String> pendingConnections = Collections.synchronizedSet(new HashSet<>());
    private final Set<String> pendingUploads = Collections.synchronizedSet(new HashSet<>());
    
    private static SosMeshPlugin pluginInstance = null;

    // Enums
    private static final byte EMERGENCY_GENERAL = 0;
    private static final byte EMERGENCY_MEDICAL = 1;
    private static final byte EMERGENCY_FIRE = 2;
    private static final byte EMERGENCY_NATURAL_DISASTER = 3;
    private static final byte EMERGENCY_ACCIDENT = 4;
    private static final byte EMERGENCY_THREAT = 5;

    private static final byte SEVERITY_LOW = 0;
    private static final byte SEVERITY_MEDIUM = 1;
    private static final byte SEVERITY_HIGH = 2;
    private static final byte SEVERITY_CRITICAL = 3;

    private static byte getEmergencyTypeCode(String type) {
        if (type == null) return EMERGENCY_GENERAL;
        switch (type.toUpperCase()) {
            case "MEDICAL": return EMERGENCY_MEDICAL;
            case "FIRE": return EMERGENCY_FIRE;
            case "NATURAL_DISASTER": case "NATURAL": return EMERGENCY_NATURAL_DISASTER;
            case "ACCIDENT": return EMERGENCY_ACCIDENT;
            case "THREAT": return EMERGENCY_THREAT;
            default: return EMERGENCY_GENERAL;
        }
    }

    private static String getEmergencyTypeString(byte code) {
        switch (code) {
            case EMERGENCY_MEDICAL: return "MEDICAL";
            case EMERGENCY_FIRE: return "FIRE";
            case EMERGENCY_NATURAL_DISASTER: return "NATURAL_DISASTER";
            case EMERGENCY_ACCIDENT: return "ACCIDENT";
            case EMERGENCY_THREAT: return "THREAT";
            default: return "GENERAL";
        }
    }

    private static byte getSeverityCode(String severity) {
        if (severity == null) return SEVERITY_HIGH;
        switch (severity.toUpperCase()) {
            case "LOW": return SEVERITY_LOW;
            case "MEDIUM": return SEVERITY_MEDIUM;
            case "CRITICAL": return SEVERITY_CRITICAL;
            default: return SEVERITY_HIGH;
        }
    }

    private static String getSeverityString(byte code) {
        switch (code) {
            case SEVERITY_LOW: return "LOW";
            case SEVERITY_MEDIUM: return "MEDIUM";
            case SEVERITY_CRITICAL: return "CRITICAL";
            default: return "HIGH";
        }
    }

    @CapacitorPlugin(name = "SosMesh")
    public class SosMeshPlugin extends Plugin {
        @Override
        public void load() {
            pluginInstance = this;
        }

        public void emitEvent(String eventName, JSObject data) {
            notifyListeners(eventName, data);
        }

        @PluginMethod
        public void startMesh(PluginCall call) {
            startMeshScanningAndAdvertising();
            call.resolve();
        }

        @PluginMethod
        public void stopMesh(PluginCall call) {
            stopMeshScanningAndAdvertising();
            call.resolve();
        }

        @PluginMethod
        public void sendSOS(PluginCall call) {
            String sosIdStr = call.getString("sosId");
            String touristIdStr = call.getString("touristId");
            Double lat = call.getDouble("latitude");
            Double lng = call.getDouble("longitude");
            Integer battery = call.getInt("battery", 100);
            String emergencyType = call.getString("emergencyType", "GENERAL");
            String severity = call.getString("severity", "HIGH");

            if (touristIdStr == null || lat == null || lng == null) {
                call.reject("Missing required fields: touristId, latitude, longitude");
                return;
            }

            try {
                UUID sosId = (sosIdStr != null && !sosIdStr.isEmpty()) ? UUID.fromString(sosIdStr) : UUID.randomUUID();
                UUID touristId = UUID.fromString(touristIdStr);
                
                long timestamp = System.currentTimeMillis() / 1000L;
                byte batteryByte = (byte) battery.intValue();
                byte typeCode = getEmergencyTypeCode(emergencyType);
                byte severityCode = getSeverityCode(severity);
                byte hopCount = 0;
                byte ttl = 3; // Hop limit of 3

                byte[] packedData = packSosMesh(sosId, touristId, lat.floatValue(), lng.floatValue(), timestamp, batteryByte, typeCode, severityCode, hopCount, ttl);
                processedSosIds.add(sosId);
                
                activePacketData = packedData;
                if (meshCharacteristic != null) {
                    meshCharacteristic.setValue(packedData);
                }
                
                startAdvertising(packedData);
                startScanning();
                
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to format SOS: " + e.getMessage());
            }
        }

        @PluginMethod
        public void getMeshStatus(PluginCall call) {
            JSObject ret = new JSObject();
            ret.put("isScanning", isScanning);
            ret.put("isAdvertising", isAdvertising);
            ret.put("bluetoothState", getBluetoothStateString());
            call.resolve(ret);
        }
    }

    private String getBluetoothStateString() {
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager == null) return "UNAVAILABLE";
        BluetoothAdapter adapter = manager.getAdapter();
        if (adapter == null) return "UNAVAILABLE";
        return adapter.isEnabled() ? "ON" : "OFF";
    }

    // Packet Packer / Unpacker Helper
    private static byte[] packSosMesh(
        UUID sosId, UUID touristId, float latitude, float longitude, 
        long timestamp, byte battery, byte emergencyType, byte severity, 
        byte hopCount, byte ttl
    ) {
        ByteBuffer buffer = ByteBuffer.allocate(49);
        buffer.order(ByteOrder.BIG_ENDIAN);
        
        buffer.putLong(sosId.getMostSignificantBits());
        buffer.putLong(sosId.getLeastSignificantBits());
        
        buffer.putLong(touristId.getMostSignificantBits());
        buffer.putLong(touristId.getLeastSignificantBits());
        
        buffer.putFloat(latitude);
        buffer.putFloat(longitude);
        buffer.putInt((int) timestamp);
        buffer.put(battery);
        buffer.put(emergencyType);
        buffer.put(severity);
        buffer.put(hopCount);
        buffer.put(ttl);
        
        return buffer.array();
    }

    public static class SosMeshPacket {
        public UUID sosId;
        public UUID touristId;
        public float latitude;
        public float longitude;
        public long timestamp;
        public int battery;
        public String emergencyType;
        public String severity;
        public int hopCount;
        public int ttl;

        public static SosMeshPacket unpack(byte[] bytes) {
            if (bytes == null || bytes.length < 49) return null;
            try {
                ByteBuffer buffer = ByteBuffer.wrap(bytes);
                buffer.order(ByteOrder.BIG_ENDIAN);
                
                SosMeshPacket p = new SosMeshPacket();
                p.sosId = new UUID(buffer.getLong(), buffer.getLong());
                p.touristId = new UUID(buffer.getLong(), buffer.getLong());
                p.latitude = buffer.getFloat();
                p.longitude = buffer.getFloat();
                p.timestamp = buffer.getInt() & 0xFFFFFFFFL;
                p.battery = buffer.get() & 0xFF;
                p.emergencyType = getEmergencyTypeString(buffer.get());
                p.severity = getSeverityString(buffer.get());
                p.hopCount = buffer.get() & 0xFF;
                p.ttl = buffer.get() & 0xFF;
                return p;
            } catch (Exception e) {
                return null;
            }
        }

        public String toJSONString() {
            try {
                JSONObject obj = new JSONObject();
                obj.put("tourist_id", touristId.toString());
                obj.put("latitude", latitude);
                obj.put("longitude", longitude);
                obj.put("battery_status", battery);
                
                // Convert timestamp to ISO date format
                java.text.DateFormat df = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
                df.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                String triggeredAt = df.format(new java.util.Date(timestamp * 1000L));
                obj.put("triggered_at", triggeredAt);
                
                // Add extended mesh info
                obj.put("sos_id", sosId.toString());
                obj.put("emergency_type", emergencyType);
                obj.put("severity", severity);
                obj.put("hop_count", hopCount);
                obj.put("ttl", ttl);
                return obj.toString();
            } catch (Exception e) {
                return "{}";
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
        registerPlugin(SosMeshPlugin.class);
        super.onCreate(savedInstanceState);
        checkAndRequestPermissions();
        setupBLERelay();
        setupNetworkMonitoring();
    }

    @Override
    public void onResume() {
        super.onResume();
        setupBLERelay();
    }

    private void setupBLERelay() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Location permission missing, BLE mesh won't start.");
                return;
            }
        }
        try {
            BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
            if (manager == null) return;
            BluetoothAdapter adapter = manager.getAdapter();
            
            if (adapter == null) {
                Log.e(TAG, "Bluetooth Adapter not found on this device.");
                return;
            }
            
            if (!adapter.isEnabled()) {
                Log.w(TAG, "Bluetooth is DISABLED. Waiting for user to enable...");
                return;
            }

            advertiser = adapter.getBluetoothLeAdvertiser();
            scanner = adapter.getBluetoothLeScanner();

            if (gattServer == null) {
                setupGattServer(manager);
            }
        } catch (Exception e) {
            Log.e(TAG, "BLE Setup error: " + e.getMessage());
        }
    }

    private void setupGattServer(BluetoothManager manager) {
        gattServer = manager.openGattServer(this, gattServerCallback);
        if (gattServer == null) return;

        BluetoothGattService service = new BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        meshCharacteristic = new BluetoothGattCharacteristic(
            CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        );
        service.addCharacteristic(meshCharacteristic);
        gattServer.addService(service);
        Log.i(TAG, "GATT Server started with SosMesh Service");
    }

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            super.onConnectionStateChange(device, status, newState);
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.i(TAG, "Device connected to GATT server: " + device.getAddress());
            }
        }

        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset, BluetoothGattCharacteristic characteristic) {
            super.onCharacteristicReadRequest(device, requestId, offset, characteristic);
            if (characteristic.getUuid().equals(CHARACTERISTIC_UUID)) {
                byte[] val = activePacketData;
                if (val != null) {
                    if (offset > val.length) {
                        gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null);
                        return;
                    }
                    byte[] responseBytes = new byte[val.length - offset];
                    System.arraycopy(val, offset, responseBytes, 0, responseBytes.length);
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, responseBytes);
                } else {
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, offset, null);
                }
            }
        }
    };

    private void startMeshScanningAndAdvertising() {
        setupBLERelay();
        startScanning();
        if (activePacketData != null) {
            startAdvertising(activePacketData);
        }
    }

    private void stopMeshScanningAndAdvertising() {
        stopScanning();
        stopAdvertising();
    }

    private void startScanning() {
        if (scanner == null || isScanning) return;
        
        List<ScanFilter> filters = new ArrayList<>();
        filters.add(new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE_UUID)).build());

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .build();

        try {
            scanner.startScan(filters, settings, scanCallback);
            isScanning = true;
            Log.i(TAG, "BLE Mesh Scanning started");
            
            // Watchdog scan restart
            handler.removeCallbacksAndMessages(null);
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (isScanning) {
                        stopScanning();
                        startScanning();
                    }
                }
            }, 120000);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start scanning: " + e.getMessage());
        }
    }

    private void stopScanning() {
        if (scanner == null || !isScanning) return;
        try {
            scanner.stopScan(scanCallback);
            isScanning = false;
            Log.i(TAG, "BLE Mesh Scanning stopped");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop scanning: " + e.getMessage());
        }
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            super.onScanResult(callbackType, result);
            if (result.getScanRecord() == null) return;
            
            // 1. Try 16-bit Service Data (connectionless mesh match)
            byte[] serviceData = result.getScanRecord().getServiceData(new ParcelUuid(SERVICE_UUID_16));
            if (serviceData != null && serviceData.length == 25) {
                ByteBuffer buffer = ByteBuffer.wrap(serviceData);
                buffer.order(ByteOrder.BIG_ENDIAN);
                UUID sosId = new UUID(buffer.getLong(), buffer.getLong());

                if (processedSosIds.contains(sosId)) {
                    return; // Skip duplicate
                }

                String address = result.getDevice().getAddress();
                if (!pendingConnections.contains(address)) {
                    pendingConnections.add(address);
                    result.getDevice().connectGatt(MainActivity.this, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE);
                }
                return;
            }

            // 2. Try 128-bit Service UUID fallback (matches iOS / background beacons)
            List<ParcelUuid> serviceUuids = result.getScanRecord().getServiceUuids();
            if (serviceUuids != null) {
                for (ParcelUuid parcelUuid : serviceUuids) {
                    if (parcelUuid.getUuid().equals(SERVICE_UUID)) {
                        String address = result.getDevice().getAddress();
                        if (!pendingConnections.contains(address)) {
                            pendingConnections.add(address);
                            result.getDevice().connectGatt(MainActivity.this, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE);
                        }
                        break;
                    }
                }
            }
        }
    };

    private final BluetoothGattCallback gattClientCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                pendingConnections.remove(gatt.getDevice().getAddress());
                gatt.close();
                return;
            }
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
                if (data != null && data.length == 49) {
                    handleIncomingMeshPacket(data);
                }
            }
            gatt.disconnect();
        }
    };

    private void startAdvertising(byte[] fullData) {
        if (advertiser == null || fullData == null || fullData.length < 49) return;
        stopAdvertising();

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build();

        // Shrink the 49-byte packet to 25 bytes to fit legacy BLE 31-byte limit:
        // 16 bytes SOS ID + 4 bytes Lat + 4 bytes Lng + 1 byte (lower 4 bits Hop Count, upper 4 bits TTL)
        byte[] adPayload = new byte[25];
        System.arraycopy(fullData, 0, adPayload, 0, 16); // copy SOS ID
        System.arraycopy(fullData, 32, adPayload, 16, 8); // copy Lat & Lng (bytes 32-39 in fullData)
        
        byte hopCount = fullData[47];
        byte ttl = fullData[48];
        adPayload[24] = (byte) ((hopCount & 0x0F) | ((ttl & 0x0F) << 4));

        AdvertiseData advertiseData = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(new ParcelUuid(SERVICE_UUID))
            .build();

        AdvertiseData scanResponse = new AdvertiseData.Builder()
            .addServiceData(new ParcelUuid(SERVICE_UUID_16), adPayload)
            .build();

        advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback);
        isAdvertising = true;
        Log.i(TAG, "BLE Mesh Advertising started (128-bit Primary + 16-bit Service Data Scan Response)");
    }

    private void stopAdvertising() {
        if (advertiser == null || !isAdvertising) return;
        try {
            advertiser.stopAdvertising(advertiseCallback);
            isAdvertising = false;
            Log.i(TAG, "BLE Mesh Advertising stopped");
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop advertising: " + e.getMessage());
        }
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            super.onStartSuccess(settingsInEffect);
            Log.i(TAG, "BLE Mesh advertising started successfully");
        }

        @Override
        public void onStartFailure(int errorCode) {
            super.onStartFailure(errorCode);
            Log.e(TAG, "BLE Mesh advertising failed: " + errorCode);
        }
    };

    private void handleIncomingMeshPacket(byte[] data) {
        SosMeshPacket packet = SosMeshPacket.unpack(data);
        if (packet == null) return;

        if (processedSosIds.contains(packet.sosId)) return;
        processedSosIds.add(packet.sosId);
        
        Log.i(TAG, "Received SOS Mesh Packet! SOS ID: " + packet.sosId + ", Hops: " + packet.hopCount);

        // Notify UI layer
        if (pluginInstance != null) {
            JSObject jsObj = new JSObject();
            jsObj.put("sosId", packet.sosId.toString());
            jsObj.put("touristId", packet.touristId.toString());
            jsObj.put("latitude", packet.latitude);
            jsObj.put("longitude", packet.longitude);
            jsObj.put("battery", packet.battery);
            jsObj.put("emergencyType", packet.emergencyType);
            jsObj.put("severity", packet.severity);
            jsObj.put("hopCount", packet.hopCount);
            jsObj.put("ttl", packet.ttl);
            pluginInstance.emitEvent("onSOSReceived", jsObj);
        }

        String jsonString = packet.toJSONString();

        if (isOnline()) {
            // Relaying directly since we are online!
            new Thread(() -> {
                if (uploadRelayPacket(jsonString)) {
                    Log.i(TAG, "SOS packet relayed to backend successfully.");
                    if (pluginInstance != null) {
                        JSObject jsObj = new JSObject();
                        jsObj.put("sosId", packet.sosId.toString());
                        pluginInstance.emitEvent("onSOSDelivered", jsObj);
                    }
                } else {
                    Log.w(TAG, "Upload failed. Queueing packet for retry.");
                    pendingUploads.add(jsonString);
                    startRelayingOfflinePacket(packet);
                }
            }).start();
        } else {
            // Offline: Re-advertise (relay)
            Log.i(TAG, "Offline. Forwarding packet via BLE...");
            pendingUploads.add(jsonString);
            startRelayingOfflinePacket(packet);
        }
    }

    private void startRelayingOfflinePacket(SosMeshPacket packet) {
        if (packet.ttl <= 1) {
            Log.w(TAG, "TTL expired. Dropping packet.");
            return;
        }

        byte newHopCount = (byte) (packet.hopCount + 1);
        byte newTtl = (byte) (packet.ttl - 1);
        
        byte typeCode = getEmergencyTypeCode(packet.emergencyType);
        byte severityCode = getSeverityCode(packet.severity);

        byte[] relayedData = packSosMesh(
            packet.sosId, packet.touristId, packet.latitude, packet.longitude, 
            packet.timestamp, (byte) packet.battery, typeCode, severityCode, 
            newHopCount, newTtl
        );

        activePacketData = relayedData;
        if (meshCharacteristic != null) {
            meshCharacteristic.setValue(relayedData);
        }
        
        startAdvertising(relayedData);

        if (pluginInstance != null) {
            JSObject jsObj = new JSObject();
            jsObj.put("sosId", packet.sosId.toString());
            jsObj.put("hopCount", (int) newHopCount);
            pluginInstance.emitEvent("onSOSRelayed", jsObj);
        }
    }

    private boolean isOnline() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        android.net.Network activeNetwork = manager.getActiveNetwork();
        if (activeNetwork == null) return false;
        NetworkCapabilities caps = manager.getNetworkCapabilities(activeNetwork);
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    private void setupNetworkMonitoring() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return;
        manager.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(android.net.Network network) {
                super.onAvailable(network);
                Log.i(TAG, "Network connection restored. Syncing pending upload queue...");
                syncPendingUploads();
            }
        });
    }

    private void syncPendingUploads() {
        if (pendingUploads.isEmpty()) return;
        new Thread(() -> {
            synchronized (pendingUploads) {
                List<String> toRemove = new ArrayList<>();
                for (String packetJson : pendingUploads) {
                    if (uploadRelayPacket(packetJson)) {
                        toRemove.add(packetJson);
                        try {
                            JSONObject obj = new JSONObject(packetJson);
                            String sosId = obj.getString("sos_id");
                            if (pluginInstance != null) {
                                JSObject jsObj = new JSObject();
                                jsObj.put("sosId", sosId);
                                pluginInstance.emitEvent("onSOSDelivered", jsObj);
                            }
                        } catch (Exception e) { /* ignore */ }
                    }
                }
                pendingUploads.removeAll(toRemove);
            }
        }).start();
    }

    private boolean uploadRelayPacket(String jsonPayload) {
        try {
            URL url = new URL(serverUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            
            JSONObject json = new JSONObject();
            json.put("payload", jsonPayload);
            String jsonInputString = json.toString();
            
            byte[] input = jsonInputString.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(input, 0, input.length);
            }

            int code = conn.getResponseCode();
            return (code == 200 || code == 201);
        } catch (Exception e) {
            Log.w(TAG, "Network sync upload failed: " + e.getMessage());
            return false;
        }
    }
}
