#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Exports the BleSosRelay Swift plugin to JavaScript
CAP_PLUGIN(BleSosRelayPlugin, "BleSosRelay",
    CAP_PLUGIN_METHOD(setServerUrl, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(advertiseSOS, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(advertiseSOSBinary, CAPPluginReturnPromise);
)
