'use strict';

const opsgenie = require('opsgenie-sdk');
const {WebClient} = require('@slack/client');
const keyBy = require('lodash.keyby');
const omit = require('lodash.omit');
const mapValues = require('lodash.mapvalues');

const token = process.env.SLACK_VERIFICATION_TOKEN,
    accessToken = process.env.SLACK_ACCESS_TOKEN,
    opsgenieApiKey = process.env.OPSGENIE_API_KEY;

function extractAlertIdFromLink(linkUrl) {
    function execRegex(regExp, text) {
        return regExp.exec(text);
    }

    // this expression is to extract alert id from the url you see when you open an alert in OG
    // https://app.opsgenie.com/alert/V2#/show/6f756050-b815-4ca2-82b9-beffac75779d-1516617363949/details
    // You improve this for other cases and possible opsg.in short urls. Then :party:
    const extractedIdArray = execRegex(new RegExp('show/(.*)/details', 'ig'), linkUrl);

    if (!extractedIdArray || extractedIdArray.length < 1) {
        return null;
    } else {
        return extractedIdArray[1];
    }
}

function getOpsGenieAlert(alertId) {
    return new Promise((resolve, reject) => {
        // pass opsgenie api key to opsgenie node client
        opsgenie.configure({'api_key': opsgenieApiKey});

        opsgenie.alertV2.get({
                                 identifier: alertId,
                                 identifierType: "id"
                             },
                             function (error, alert) {
                                 if (error) {
                                     reject(error);
                                 } else {
                                     resolve(alert);
                                 }
                             });
    });
}

function messageAttachmentFromLink(link) {

    const alertId = extractAlertIdFromLink(link.url);

    return getOpsGenieAlert(alertId).then((alert) => {
        const d = alert.data;
        return {
            "color": "#36a64f",
            "title": "OpsGenie Alert #" + d.tinyId,
            "title_link": "https://opsg.in/i/" + d.tinyId,
            "text": d.message,
            "fields": [
                {
                    "title": "Priority",
                    "value": d.priority,
                    "short": true
                },
                {
                    "title": "Status",
                    "value": d.status,
                    "short": true
                }
            ],
            "footer": "OpsGenie",
            "footer_icon": "https://cdn2.hubspot.net/hubfs/2759414/og-logo-small.png",
            url: link.url
        };
    });
}

module.exports.unfurl = (event, context, callback) => {

    const payload = event.body;

    // verify necessary tokens are set in environment variables
    if (!token || !accessToken || !opsgenieApiKey) {
        return callback("OpsGenie ApiKey, Slack verification token and access token should be set");
    }

    // Verification Token validation to make sure that the request comes from Slack
    if (token && token !== payload.token) {
        return callback("[401] Unauthorized");
    }

    if (payload.type === "event_callback") {
        const slack = new WebClient(accessToken);
        const event = payload.event;

        Promise.all(event.links.map(messageAttachmentFromLink))
            .then(attachments => keyBy(attachments, 'url'))
            .then(unfurls => mapValues(unfurls, attachment => omit(attachment, 'url')))
            .then(unfurls => slack.chat.unfurl(event.message_ts, event.channel, unfurls))
            .catch(console.error);

        return callback();
    }
    // challenge sent by Slack when you first configure Events API
    else if (payload.type === "url_verification") {
        return callback(null, payload.challenge);
    } else {
        console.error("An unknown event type received.", event);
        return callback("Unkown event type received.");
    }

};