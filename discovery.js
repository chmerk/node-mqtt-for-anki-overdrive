//------------------------------------------------------------------------------
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

var noble = require('noble');

console.log('Starting to look for cars...');
console.log('Only powered on cars, that are not connected can be found \n(normally indicated by \033[32m green light\033[0m)');

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning();

    setTimeout(function() {
       noble.stopScanning();
       process.exit(0);
     }, 2000);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  var serviceUuids = JSON.stringify(peripheral.advertisement.serviceUuids);
  if(serviceUuids.indexOf("be15beef6186407e83810bd89c4d8df4") > -1) {
    console.log('Car discovered. ID: ' + peripheral.id); 
  }
});