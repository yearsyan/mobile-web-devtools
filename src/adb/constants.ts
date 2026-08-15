/** Android Open Accessory / ADB USB interface descriptor. */
export const ADB_USB_INTERFACE = Object.freeze({
  classCode: 0xff,
  subclassCode: 0x42,
  protocolCode: 0x01,
});

export const ADB_USB_FILTERS = Object.freeze([ADB_USB_INTERFACE]);
