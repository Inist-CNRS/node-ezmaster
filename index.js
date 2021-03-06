// IMAGE_BASENAME="library/nginx" node scripts/create-application.js


module.exports.EZMASTER_BASEURL     = process.env.EZMASTER_BASEURL ? process.env.EZMASTER_BASEURL : "http://127.0.0.1:35269";
module.exports.EZMASTER_USER        = process.env.EZMASTER_USER ? process.env.EZMASTER_USER : "";
module.exports.EZMASTER_PASSWORD    = process.env.EZMASTER_PASSWORD ? process.env.EZMASTER_PASSWORD : "";

module.exports.APPLICATION_BASENAME = process.env.APPLICATION_BASENAME ? process.env.APPLICATION_BASENAME : "istex/istex-dl";
module.exports.INSTANCE_BASENAME    = process.env.INSTANCE_BASENAME ? process.env.INSTANCE_BASENAME : "istex-dl";
module.exports.CONFIG_FROM_INSTANCE = process.env.CONFIG_FROM_INSTANCE ? process.env.CONFIG_FROM_INSTANCE    : "";

// prepare the commun auth parameter
module.exports.request_option = {};
if (module.exports.EZMASTER_USER) {
    module.exports.request_option.auth = {
        username: module.exports.EZMASTER_USER,
        password: module.exports.EZMASTER_PASSWORD,
        sendImmediately: true,
    }
}

var request = require('request');

module.exports.setupNoProxyStuff = function () {
    // exclude ezmaster from proxified hostnames
    // (npm request package takes into account this env var)
    let no_proxy = process.env.no_proxy ? process.env.no_proxy.split(',') : [ '' ];
    no_proxy.push('ezmaster');
    no_proxy.push('ezmaster-api');
    no_proxy.push('127.0.0.1');
    no_proxy.filter(e => e.trim() !== '');
    process.env.no_proxy = no_proxy.join(',');
    process.env.NO_PROXY = no_proxy.join(',');
}

module.exports.createEzmasterApp = function(APPLICATION_BASENAME, APPLICATION_TAG, cb) {
    console.log('ezmaster app creating => ', APPLICATION_BASENAME + ':' + APPLICATION_TAG);
    request.post(module.exports.EZMASTER_BASEURL + '/-/v1/app', {
        auth: module.exports.request_option.auth,
        timeout: 120 * 1000, // 2 minutes
        form: {
            imageName: APPLICATION_BASENAME,
            versionImage: APPLICATION_TAG,
            imageHub: "",
            username: "",
            password: "",
            email: ""
        }
    }).on('end', function() {
        console.log('ezmaster app created => ', APPLICATION_BASENAME + ':' + APPLICATION_TAG);
        return cb && cb(null);
    }).on('error', function(err) {
        console.error('error', err);
        return cb && cb(err);
    });
}



module.exports.getLatestInstanceVersion = function(INSTANCE_BASENAME, cb) {
    INSTANCE_BASENAME = INSTANCE_BASENAME.split('-');
    request.get(module.exports.EZMASTER_BASEURL + '/-/v1/instances', module.exports.request_option,
        function(err, response, instances) {
            err && console.error(err);
            instances = JSON.parse(instances);
            let versions = [];
            Object.keys(instances).forEach(function(instanceName) {
                instanceName = instanceName.split('-');
                if (instanceName[0] == INSTANCE_BASENAME[0] &&
                    instanceName[1] == INSTANCE_BASENAME[1]) {
                    if (instanceName.length > 2) {
                        versions.push(parseInt(instanceName[2], 10));
                    }
                }
            });
            const maxVersion = versions.length > 0 ? Math.max(...versions) : 0;
            return cb && cb(null, maxVersion);
        });
}


module.exports.createNewInstance = function(longName, technicalName, applicationName, cb) {
    // {"longName":"aaa","project":"istex","version":"2","study":"istexdl","technicalName":"istex-istexdl-2","app":"istex/istex-dl:4.4.0"}
    console.log('ezmaster instance creating => ', technicalName);
    request.post(module.exports.EZMASTER_BASEURL + '/-/v1/instances', {
        auth:  module.exports.request_option.auth,
        timeout: 120 * 1000, // 2 minutes
        form: {
            app: applicationName,
            longName: longName,
            technicalName: technicalName,
            project: technicalName.split('-')[0],
            study: technicalName.split('-')[1],
            version: technicalName.split('-')[2],
        }
    }).on('end', function() {
        console.log('ezmaster instance created => ', technicalName);
        return cb && cb(null);
    }).on('error', function(err) {
        console.error('error', err);
        return cb && cb(err);
    });
}

module.exports.downloadAndCreateLatestApplication = function(APPLICATION_BASENAME, cb) {
    // latest image tag
    var url = 'https://hub.docker.com/v2/repositories/' + APPLICATION_BASENAME + '/tags/?page_size=1';
    console.log('Searching latest app from:', url);
    request.get(url,
        function(err, response, APPLICATION_LATEST_TAG) {
            err && console.error(err);
            APPLICATION_LATEST_TAG = JSON.parse(APPLICATION_LATEST_TAG);
            APPLICATION_LATEST_TAG = APPLICATION_LATEST_TAG.results[0].name;
            const APPLICATION_NAME = APPLICATION_BASENAME + ':' + APPLICATION_LATEST_TAG;

            request.get(
                module.exports.EZMASTER_BASEURL + '/-/v1/app', module.exports.request_option,
                function(err, response, apps) {
                    err && console.error(err);
                    apps = JSON.parse(apps);
                    let found = false;
                    apps.forEach(function(app) {
                        const applicationName = app.imageName;
                        found |= (applicationName === APPLICATION_NAME);
                    });
                    if (!found) {
                        // ezmaster app not found, we can create a new one
                        return module.exports.createEzmasterApp(
                            APPLICATION_BASENAME,
                            APPLICATION_LATEST_TAG,
                            function(err) {
                                if (err) return cb && cb(err);
                                return cb && cb(null, APPLICATION_NAME);
                            }
                        );
                    } else {
                        console.log('ezmaster app already exists => ', APPLICATION_NAME)
                        return cb && cb(null, '');
                    }
                });

        }
    );
}


module.exports.getGithubTagComment = function(APPLICATION_BASENAME, TAG, cb) {
    request.get({
            url: 'https://api.github.com/repos/' + APPLICATION_BASENAME + '/tags',
            headers: { 'User-Agent': 'node-request' } // mandatory for github
        },
        function(err, response, tags) {
            err && console.error(err);
            tags = JSON.parse(tags);
            let commitFound = false;
            tags.forEach(function(tag) {
                if (tag.name === TAG) {
                    commitFound = tag.commit.sha;
                }
            });
            if (!commitFound) return cb(null, '');
            request.get({
                    url: 'https://api.github.com/repos/' + APPLICATION_BASENAME + '/git/commits/' + commitFound,
                    headers: { 'User-Agent': 'node-request' } // mandatory for github
                },
                function(err, response, commit) {
                    err && console.error(err);
                    commit = JSON.parse(commit);
                    return cb && cb(null, commit.message);
                }
            );
        }
    );
}

module.exports.getInstanceFromName = function(INSTANCE_NAME, cb) {
    request.get(module.exports.EZMASTER_BASEURL + '/-/v1/instances', module.exports.request_option,
        function(err, response, instances) {
            if (err) return console.error(err) && cb(err);
            instances = JSON.parse(instances);
            Object.keys(instances).forEach(function(instanceName) {
                if (instanceName == INSTANCE_NAME) {
                    return cb && cb(null, instances[instanceName]);
                }
            });
        }
    );
}

module.exports.updateInstanceConfig = function(INSTANCE_NAME, config, cb) {
    console.log('ezmaster updating instance config => ', INSTANCE_NAME);
    module.exports.getInstanceFromName(INSTANCE_NAME, function(err, instance) {
        request.put(module.exports.EZMASTER_BASEURL + '/-/v1/instances/config/' + instance.containerId, {
            auth: module.exports.request_option.auth,
            timeout: 120 * 1000, // 2 minutes
            json: { newConfig: config }
        }).on('end', function() {
            console.log('ezmaster instance config updated => ', INSTANCE_NAME);
            return cb && cb(null);
        }).on('error', function(err) {
            console.error('error', err);
            return cb && cb(err);
        });
    });
}

module.exports.getInstanceDetailsFromName = function(INSTANCE_NAME, cb) {
    module.exports.getInstanceFromName(INSTANCE_NAME, function(err, instance) {
        request.get(module.exports.EZMASTER_BASEURL + '/-/v1/instances/' + instance.containerId, module.exports.request_option, function(err, response, details) {
            details = JSON.parse(details);
            return cb && cb(err, details);
        });
    });
}