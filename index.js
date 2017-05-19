var Keystone = require('./lib/keystone');
var Glance   = require('./lib/glance');
var Neutron  = require('./lib/neutron');
var Nova     = require('./lib/nova');

// A convenience method for quick/dirty work for those that already have a project_id
// calls back with (error, project) where project already has all the individual objects setup
// ie: project.nova, project.glance, etc..
function getSimpleProject(username, password, project_id, keystone_url, callback) {
	var keystone = new Keystone(keystone_url);

	var return_object = {};
	var glance_url    = '';
	var neutron_url   = '';
	var nova_url      = '';
	var catalog_array = [];

	var n = 0;
	var j = 0;

	var endpoint_type = '';

	keystone.getToken(username, password, (error, token) => {
		if (error) {
			if (typeof callback === 'function') { callback(error); }
			callback = undefined;
			return;
		}

		keystone.getProjectToken(token.token, project_id, (error, project_token) => {
			if (error) {
				if (typeof callback === 'function') { callback(error); }
				callback = undefined;
				return;
			}

			catalog_array = project_token.catalog;
			for (n = 0; n < catalog_array.length; n++) {
				// ELS Puppet sometimes screws up Keystone and puts in duplicate service entries
				// that have no endpoints.. ignore these.
				if (!catalog_array[n].endpoints || !catalog_array[n].endpoints.length) {
					continue;
				}

				endpoints_array = catalog_array[n].endpoints;
				endpoint_type   = catalog_array[n].type;

				for (j = 0; j < endpoints_array.length; j++) {
					if (endpoints_array[j].interface == 'public') {
						endpoints_array[j].url = endpoints_array[j].url.replace(/\/$/, "");//yank any trailing /'s,

						if (endpoint_type == 'image') {
							// we have to add the v2 to the end to get the most current functionality
							glance_url = endpoints_array[j].url + '/v2.0';
						}

						else if (endpoint_type == 'network') {
							// we have to add the v2 to the end to get the most current functionality
							neutron_url = endpoints_array[j].url + '/v2.0';
						}

						else if (endpoint_type == 'compute') {
							nova_url = endpoints_array[j].url;
						}

						break;
					}
				}
			}

			return_object.general_token = token;
			return_object.project_token = project_token;
			return_object.glance        = new Glance(glance_url, project_token.token);
			return_object.neutron       = new Neutron(neutron_url, project_token.token);
			return_object.nova          = new Nova(nova_url, project_token.token);

			if (typeof callback === 'function') { callback(null, return_object); }
			callback = undefined;
		});
	});
}

module.exports = {
	Glance           : Glance,
	Keystone         : Keystone,
	Neutron          : Neutron,
	Nova             : Nova,
	getSimpleProject : getSimpleProject
};
