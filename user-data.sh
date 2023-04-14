#!/bin/bash

##
## This script cannot be executed directly
## Configuration variables are accessible via [[key]] which are autoloaded from the runtime configuration
##

shutdownOnError=[[shutdownOnError]]
shutdownOnComplete=[[shutdownOnComplete]]
wasError="false"
datecode=`date +%Y%m%d-%H%M%S`
sudo su &&

##  load aws profile data
mkdir /root/.aws &&
echo "[awsprofile]" >> /root/.aws/credentials &&
echo "aws_access_key_id = [[access_key_id]]" >> /root/.aws/credentials &&
echo "aws_secret_access_key = [[secret_access_key]]" >> /root/.aws/credentials &&

##  setup muledump-asset-compiler
yum -y install unzip git aws-cli nodejs npm &&
[[buildsteps]]
npm install > mac-$datecode-log.txt &&

##  run bootstrap script
sh ./run-linux-al2023.sh \
  --buildhash [[buildhash]] \
  --aws-profile awsprofile \
  --s3-bucket [[s3_bucket]] \
  --s3-prefix-assets [[s3_prefix_assets]] \
  --s3-prefix-renders [[s3_prefix_renders]] \
  --buildinfo-https [[buildInfoHTTPS]] \
  --buildinfo-s3 [[buildInfoS3]] >> mac-$datecode-log.txt

if [ $? -ne 0 ]; then
  echo
  echo "Stack exited with an error"
  wasError="true"
fi

##  cleanup
datetime=`date`
echo "Last Runtime: $datetime" > last-runtime.txt
aws --profile awsprofile s3 cp last-runtime.txt s3://[[s3_bucket]]/[[s3_log_path]]/
aws --profile awsprofile s3 cp mac-$datecode-log.txt s3://[[s3_bucket]]/[[s3_log_path]]/$(date +%Y)/$(date +%m)/$(date +%d)/

##  shutdown sequence
if [ "$wasError" = "true" ] && [ "$shutdownOnError" = "false" ]; then
  echo
  echo "An error occurred and shutdownOnError=false"
  echo "Skipping shutdown"
  exit
fi

if [ "$shutdownOnComplete" = "true" ]; then
  echo
  echo "Shutting down now"
  shutdown -t 0 -h now
fi

echo
echo "Complete"
