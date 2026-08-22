#include <Wire.h>
#include "Adafruit_AS726x.h"

Adafruit_AS726x sensor;
const uint8_t readingsPerScan = 10;

void setup() {
  Serial.begin(115200);
  sensor.begin();
}

void loop() {
  if (Serial.available() == 0) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  command.trim();
  if (command != "SCAN") {
    return;
  }

  for (uint8_t reading = 0; reading < readingsPerScan; reading++) {
    sensor.takeMeasurements();
    Serial.print(sensor.getTemperature(), 1);
    Serial.print(',');
    Serial.print(sensor.getCalibratedViolet());
    Serial.print(',');
    Serial.print(sensor.getCalibratedBlue());
    Serial.print(',');
    Serial.print(sensor.getCalibratedGreen());
    Serial.print(',');
    Serial.print(sensor.getCalibratedYellow());
    Serial.print(',');
    Serial.print(sensor.getCalibratedOrange());
    Serial.print(',');
    Serial.println(sensor.getCalibratedRed());
  }

  Serial.println("SCAN_COMPLETE");
}