#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Exports the SosMesh Swift plugin to JavaScript
CAP_PLUGIN(SosMeshPlugin, "SosMesh",
    CAP_PLUGIN_METHOD(startMesh, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopMesh, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(sendSOS, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getMeshStatus, CAPPluginReturnPromise);
)
