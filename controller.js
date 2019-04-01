
//------------------------------------------------------------------------------
// The original Version of this Software was developed by Niklas Heidloff (IBM),
// and was published on Github under Apache License 2.0, see below.
// (https://github.com/IBM-Cloud/node-mqtt-for-anki-overdrive)
// 
// It was further developed (altered and extended) by Christoph Merk 
// (Bosch Software Innovations) for a Demo Showcase with the Systematic Field 
// Data Explorer (SFDE) / Bosch IoT Data Manager and is further licensed 
// under Apache License, Version 2.0
// (https://www.bosch-si.com/de/iot-data/big-data/systematic-field-data-explorer.html)
//------------------------------------------------------------------------------
// Copyright Bosch Software Innovations GmbH, 2018
// Copyright IBM Corp. 2016
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//------------------------------------------------------------------------------

var config = require('./config-wrapper.js')();
var async = require('async');
var noble = require('noble');
//var mqtt = require('mqtt');
var readline = require('readline');
var request = require('request');

var receivedMessages = require('./receivedMessages.js')();
var prepareMessages = require('./prepareMessages.js')();
var logger = require('./logger.js');
var sfdeConfig = require('./sfde-config.json');

var readCharacteristic;
var writeCharacteristic;
var car;
var lane;
var carFound = false;
var messageCounter = 0;
var lastTimestamp = 0;
// var nukeSetSpeed = 0;
// var nukeSetLane = 1;

var useSystem = sfdeConfig.useSystem;
if (useSystem == "prod") {
  var sfdeUrl = sfdeConfig.url;
  var sfdeApiKey = sfdeConfig.apiKey;
} else if (useSystem == "dev") {
  var sfdeUrl = sfdeConfig.devUrl;
  var sfdeApiKey = sfdeConfig.devApiKey;
} 

var sfdeContentType = sfdeConfig.contentType;
var sfdeAuth = sfdeConfig.auth;

// var loggerMode = 'extended';
//logger.loggero();

config.read(process.argv[2], function(carId, startlane, carName, mqttClient) {
  //console.log("Carname: ", carName );

  if (!carId) {
    console.log('Define carID in a properties file and pass in the name of the file as argv');
    process.exit(0);
  }
  lane = startlane;

  noble.startScanning();
  console.log("Scanning for cars!")
  setTimeout(function() {
    if (!carFound) {
      noble.stopScanning();
      console.log(carName, "not found!");
      process.exit(0);
      //process.on('SIGINT', exitHandler.bind(null, {exit:true}));
    }
  }, 10000);  //10 seconds to connect to car

  noble.on('discover', function(peripheral) {
    if (peripheral.id === carId) {
      noble.stopScanning();
      carFound = true;    //for check after search timeout (see above)

      var advertisement = peripheral.advertisement;
      var serviceUuids = JSON.stringify(peripheral.advertisement.serviceUuids);
      if(serviceUuids.indexOf("be15beef6186407e83810bd89c4d8df4") > -1) {
        console.log('Car discovered. ID: ' + peripheral.id); 
        car = peripheral;
        setTerminalTitle(carName);
        checkSFDE();
        setUp(car);
      }
    }
  });

  function setUp(peripheral) {
    peripheral.on('disconnect', function() {
      console.log('Car has been disconnected');
      process.exit(0);
    });

    peripheral.connect(function(error) {
      console.log('Trying to connect to car...');
      
      peripheral.discoverServices([], function(error, services) {
        var service = services[0];
        
        service.discoverCharacteristics([], function(error, characteristics) {
          var characteristicIndex = 0;

          async.whilst(
            function () {
              return (characteristicIndex < characteristics.length);
            },
            function(callback) {
              var characteristic = characteristics[characteristicIndex];

              async.series([
                function(callback) {
                  if (characteristic.uuid == 'be15bee06186407e83810bd89c4d8df4') {
                    readCharacteristic = characteristic;

                    readCharacteristic.notify(true, function(err) {
                    });

                    characteristic.on('data', function(data, isNotification) {
                      //This is the callback function called on data event (a.k.a. "incoming message")
                      messageCounter++;
                      receivedMessages.handle(data, mqttClient, messageCounter);

                      var timestamp = Date.now();
                      var payload = data.toString('hex');
                      //console.log("Payload: ", payload);

                      //  Experiment to periodically change driving behaviour of car automatically... Need to rework that!
                      //  if (carName == 'groundshock' && timestamp - lastTimestamp > 1500) {
                      //   if (nukeSetSpeed < 500) {
                      //     nukeSetSpeed = nukeSetSpeed + 100;
                      //   } else {
                      //     nukeSetSpeed = nukeSetSpeed - 100;
                      //     if (nukeSetLane < 4) {
                      //       nukeSetLane = nukeSetLane + 1;
                      //     }else {
                      //       nukeSetLane = nukeSetLane - 1;
                      //     }
                      //     var laneCommandString = "c "+nukeSetLane;
                      //   }
                      //   var speedCommmandString = "s "+nukeSetSpeed;
                      //   console.log("SPEEEEEEEEED: ", speedCommmandString);
                      //   invokeCommand(speedCommmandString);
                      //   //invokeCommand(laneCommandString);

                      // }
                      if (timestamp - lastTimestamp > 1000) {
                        invokeCommand('bat');
                        lastTimestamp = timestamp;
                      }

                      sendToSFDE(timestamp, carName, payload);
                    });
                  }

                  if (characteristic.uuid == 'be15bee16186407e83810bd89c4d8df4') {                        
                    writeCharacteristic = characteristic;

                    init(startlane); 

                    // this characterstic doesn't seem to be used for receiving data
                    characteristic.on('read', function(data, isNotification) {
                      console.log('Data received - writeCharacteristic', data);
                    });                          
                  }

                  callback();
                },
                function() {
                  characteristicIndex++;
                  callback();
                }
              ]);
            },
            function(error) {
            }
          );
        });
      });
    });
  }
});


function init(startlane) {
  console.log("Starting init...");
  // turn on sdk and set offset
  var initMessage = new Buffer(4);
  initMessage.writeUInt8(0x03, 0);
  initMessage.writeUInt8(0x90, 1);
  initMessage.writeUInt8(0x01, 2);
  initMessage.writeUInt8(0x01, 3);
  writeCharacteristic.write(initMessage, false, function(err) {
    if (!err) {
      var initialOffset = 0.0;
      if (startlane) {
        if (startlane == '1') initialOffset = 68.0;
        if (startlane == '2') initialOffset = 23.0;
        if (startlane == '3') initialOffset = -23.0;
        if (startlane == '4') initialOffset = -68.0;
      }

      initMessage = new Buffer(6);
      initMessage.writeUInt8(0x05, 0);
      initMessage.writeUInt8(0x2c, 1);
      initMessage.writeFloatLE(initialOffset, 2);
      writeCharacteristic.write(initMessage, false, function(err) {
        if (!err) {
          console.log('Initialization was successful');
          console.log('Enter a command: help, s (speed), c (change lane), e (end/stop), t (turn), l (lights), lp (lights pattern), o (offset), sdk, ping, bat, ver, q (quit)');
        }
        else {
          console.log('Initialization error');
        }
      });      
    }
    else {
      console.log('Initialization error');
    }
  });
}

function invokeCommand(cmd) {
  var message = prepareMessages.format(cmd);
  if (message) {                     
    console.log("Command: " + cmd, message);
             
    if (writeCharacteristic) { 
      writeCharacteristic.write(message, false, function(err) {
        if (!err) {
          //console.log('Command sent');
        }
        else {
          console.log('Error sending command');
        }
      });
    } else {
      console.log('Error sending command');
    }
  }
}

var cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function assembleSfdeRequestOptions (reqMethod = 'GET', messageBody = '') {
  if (reqMethod === 'GET' || reqMethod === 'POST'){
    var options = { 
      method: reqMethod, 
      url: sfdeUrl,
      headers:
      { 
        //'Authorization': sfdeAuth,
        'x-im-apikey': sfdeApiKey,
        'Content-Type': sfdeContentType
      }
    };
  } else {
    throw new Error('unknown request method for sfde request!'); 
  }
  if (reqMethod === 'POST') {
    options.body = messageBody;
  }

  return options;
}

function displaySfdeResponse(response, reqMethod = 'GET', error = null) {
  if (response && response.statusCode == 200) {
    console.log("Connection  to SFDE successful ( URL: ", response.request.href,")");
    console.log("With message: \"", JSON.parse(response.body).message, "\", Status Code: ", response.statusCode, "\n");
    
  } else {
    console.log("\x1b[31m"); //red
    console.log("No Connection (", reqMethod,") to SFDE possible! Please check Internetconnection, URL(Config File), Proxy-Setting etc.","\x1b[0m"); //color reset
    console.log("Status Code: ", response.statusCode, " Response: ", response.body);
  }
  if (error) {
    console.log("Error trying ", reqMethod, "-Request");
    //throw new Error(error);
    //process.exit(0);
  }
}

function checkSFDE () {
  var reqMethod = 'GET';
  var options = assembleSfdeRequestOptions(reqMethod);

  request(options, function (error, response, body) {
    console.log("\nChecking connection to SFDE...");
    displaySfdeResponse(response, reqMethod, error);
  });
}

function sendToSFDE (timestamp, carName, payload) {
  //console.log("Blaaaaa:", sfdeConfig.contentType)

  var messageBody = JSON.stringify({timestamp: timestamp, carname: carName, payload: payload })
  var options = assembleSfdeRequestOptions('POST', messageBody);

  request(options, function (error, response, body) {
    //dataSentCount++;
    //console.log("Data sent: ", dataSentCount, body);
    displaySfdeResponse(response, reqMethod, error);
    //if (error) throw new Error(error);
    //console.log(body);
  });
}

function setTerminalTitle(title)
{
  process.stdout.write(
    String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7)
  );
}

cli.on('line', function (cmd) {
  if (cmd == "help") {
    console.log(prepareMessages.doc());
  } 
  else {
    invokeCommand(cmd);
  }                        
});

process.stdin.resume();

function exitHandler(options, err) {
  if (car) car.disconnect();
}

process.on('exit', exitHandler.bind(null,{cleanup:true}));
process.on('SIGINT', exitHandler.bind(null, {exit:true}));
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
