# faast.js limitations

## Size limits on arguments and return values

Arguments and return values are sent through each provider's API or through a cloud queue or notification service, each of which may have a size limit. The limits will depend on the provider and mode being used:

### AWS Limits

Limits for AWS Lambda are published [here](https://docs.aws.amazon.com/lambda/latest/dg/limits.html). As of March 2019 the limits are:

- queue mode: limit of 256kb for arguments and return values.

- https mode: limit of 6MB for arguments and return values.

Note that these limits are for payloads encoded as JSON.

### Google Limits

Limits for Google Cloud Functions are published [here](https://cloud.google.com/functions/quotas). As of March 2019 the limits are:

- queue or https mode: 10MB
