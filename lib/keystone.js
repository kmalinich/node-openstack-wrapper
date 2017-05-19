var Request = require('./os-request');

// constructor - should be the only export
function Keystone(endpoint_url) {
  // set this way purely to facilitate unit test dependency injetion
  this.request = Request;

  // this is an optional lib that we override to normalfy the openstack responses - leave as is for no munging
  this.mangler = require('./mangler');
  this.mangleObject = this.mangler.mangleObject;

  // Keystone v3 is the only supported version at this point - add the url and yank all trailing slashes
  this.url = endpoint_url.replace(/\/$/, "");

  // default the timeout to false - this forces the static value to be used
  this.timeout = 9000;

  // default request id to blank - should represent the incomming request id
  this.request_id = '';

  // default to a blank user_name
  this.user_name = '';

  // logger should default to null - might consider checking for a logMetric function in that obj too?
  this.logger = null;
}

// setters for individual obj/call usage
// just set these prior to doing things and your good to go until you want to change it
Keystone.prototype.setTimeout = (new_timeout) => {
  this.timeout = new_timeout;
};

Keystone.prototype.setRequestID (request_id) => {
  this.request_id = request_id;
};

Keystone.prototype.setUserName (user_name) => {
  this.user_name = user_name;
};

Keystone.prototype.setLogger (logger) => {
  this.logger = logger;
};

// this should only be used for dependency injection
Keystone.prototype.setRequest (request_lib) => {
  this.request = request_lib;
}

// lets us mangle/sanitize/make sane the various responses from openstack
// any replacement must simply support a static mangleObject that supports the following types [ie mangleObject(type, object)]
// Project, Role, Assignment
Keystone.prototype.setMangler (mangle_lib) => {
  this.mangler = mangle_lib;
  this.mangleObject = this.mangler.mangleObject;
}


// returns an formatted options object - just makes the code below a little less repetitious
// auth_token can be either a generic or project scoped token depending what your doing
// json_value should be almost certainly be true if you don't have an actual object you want to send over
// NOTE: because keystone is non-project specific this function is different than all the other classes with it
Keystone.prototype.getRequestOptions = (auth_token, path, json_value) => {
  // start w/the instance timeout
  var request_timeout = this.timeout;
  if (!request_timeout) {
    // override with the static value if no instance value was given
    request_timeout = Keystone.timeout;
  }

  var return_object = {
    uri             : this.url + path,
    headers         : {'X-Auth-Token'  : auth_token},
    json            : json_value,
    timeout         : this.timeout,
    metricRequestID : this.request_id,
    metricUserName  : this.user_name,
    metricLogger    : this.logger
  };

  return return_object;
};


// authorizes the users against the specified keystone
// calls back with (error, token) where token is an object containing all the token info
// NOTE: the actual token value normally comes back in the header - i'm modifying this to token.token for easier consumption
Keystone.prototype.getToken = (username, password, callback) => {
  var self = this;
  var auth_data = {
    auth: {
      identity: {
        methods: ['password'],
'password': {
  user: {
    domain: {
      name: 'Default'
    },
    name: username,
'password': password,
  },
},
},
},
}

var request_options               = this.getRequestOptions('bogus', '/auth/tokens', auth_data);
request_options.headers           = {}; //we don't want the normal auth header due to bogus token
request_options.metricPath        = 'remote-calls.keystone.tokens.get';
request_options.validateStatus    = true;
request_options.requireBodyObject = 'token';

// auth-token will come back in the header for some reason as x-subject-token (used to come back in the body all nice like)
this.request.post(request_options, (error, response, body) => {
  if (error) {
    if (typeof callback === 'function') { callback(error); }
    callback = undefined;
    return;
  }

  // tiny hack here to put the actual token string back into the object
  body.token.token = response.headers['x-subject-token'];

  //now we good
  if (typeof callback === 'function') { callback(null, self.mangleObject('Token', body.token)); }
  callback = undefined;
});
};


// make a callback(error, project_authorization) with all of the data on a project and an access token for further calls on it
// NOTE: this is not the admin function that gets project details - you have to do this so I'm not bothering with that
Keystone.prototype.getProjectTokenForReal = (auth_data, callback) => {
  var self = this;

  // use the normal getRequestOptions but send in a bogus token and nullfiy the header
  // the token will get passed in the data in this call
  var request_options = this.getRequestOptions('bogus', '/auth/tokens', auth_data);
  request_options.headers = {};
  request_options.metricPath = 'remote-calls.keystone.tokens.get-project';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'token';

  this.request.post(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    // hack to put the actual token value back into the body
    body.token.token = response.headers['x-subject-token'];

    if (typeof callback === 'function') { callback(null, self.mangleObject('ProjectToken', body.token)); }
    callback = undefined;
  });
};


// make a callback(error, project_authorization) with all of the data on a project and an access token for further calls on it
// NOTE: this is not the admin function that gets project details - you have to do this so I'm not bothering with that
Keystone.prototype.getProjectToken = (access_token, project_id, callback) => {
  var auth_data = {
    auth:{
      identity:{
        methods: ['token'],
        token: {id: access_token}
      },
      scope: {
        project: {id: project_id}
      }
    }
  };

  this.getProjectTokenForReal(auth_data, callback);
};


// passthru function for future stuff
Keystone.prototype.getProjectTokenById = Keystone.prototype.getProjectToken;


// make a callback(error, project_authorization) with all of the data on a project and an access token for further calls on it
// NOTE: this is not the admin function that gets project details - you have to do this so I'm not bothering with that
Keystone.prototype.getProjectTokenByName = (access_token, domain_id, project_name, callback) => {
  var auth_data = {
    auth:{
      identity:{
        methods: ['token'],
        token: {id: access_token}
      },
      scope: {
        project: {
          domain: {id: domain_id},
          name: project_name
        }
      }
    }
  };

  this.getProjectTokenForReal(auth_data, callback);
};



// gets a list of all projects in the system
// calls back with callback(error, project_array)
// ***NOTE: admin_access_token is a scoped token from a project you have admin rights on - yes this is weird
Keystone.prototype.listProjects = (admin_access_token, callback) => {
  var self = this;
  var request_options = this.getRequestOptions(admin_access_token, '/projects', true);
  request_options.metricPath = 'remote-calls.keystone.projects.list';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'projects';

  this.request.get(request_options, (error, response, body) => {
    var projects_array =[];
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (var n = 0; n < body.projects.length; n++) {
      projects_array[n] = self.mangleObject('Project', body.projects[n]);
    }

    //tack these on for easy consupmtion and in case we ever need pagination
    projects_array.self = body.links.self;
    projects_array.previous = body.links.previous;
    projects_array.next = body.links.next;

    if (typeof callback === 'function') { callback(null, projects_array); }
    callback = undefined;
  });
};


// gets a list of projects the given token is authorized to have some access to
// calls back with (error, projects_array) and self, previous, and null are tacked on as properties of the array
Keystone.prototype.listUserProjects = (username, access_token, callback) => {
  var self = this;
  var request_options = this.getRequestOptions(access_token, '/users/' + username + '/projects', true);
  request_options.metricPath = 'remote-calls.keystone.projects.list-user';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'projects';

  this.request.get(request_options, (error, response, body) => {
    var projects_array =[];
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (var n = 0; n < body.projects.length; n++) {
      projects_array[n] = self.mangleObject('Project', body.projects[n]);
    }

    //tack these on for easy consupmtion and in case we ever need pagination
    projects_array.self = body.links.self;
    projects_array.previous = body.links.previous;
    projects_array.next = body.links.next;

    if (typeof callback === 'function') { callback(null, projects_array); }
    callback = undefined;
  });
};


// gets the details of a specific project by name
// calls back with callback(error, project_array)
// ***NOTE: admin_access_token is a scoped token from a project you have admin rights on - yes this is weird
// ***NOTE: this will return an error if 2 projects are named the same - not usable unless distinct projects are configured/required.
Keystone.prototype.getProjectByName = (admin_access_token, project_name, callback) => {
  var self = this;
  var request_options = this.getRequestOptions(admin_access_token, '/projects?name=' + project_name, true);
  request_options.metricPath = 'remote-calls.keystone.projects.get-by-name';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'projects';

  this.request.get(request_options, (error, response, body) => {
    var project_object = {};
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    if (body.projects.length > 1) {
      // kind of an error... in theory
      if (typeof callback === 'function') { callback(new Error('Found multiple projects with same name')); }
      callback = undefined;
      return;
    }

    if (body.projects.length == 0) {
      // not an error but no data either
      if (typeof callback === 'function') { callback(project_object); }
      callback = undefined;
      return;
    }

    // we are good
    project_object = self.mangleObject('Project', body.projects[0]);
    if (typeof callback === 'function') { callback(project_object); }
    callback = undefined;
  });
};


// gets a list of roles for the given project (specified by token ...kinda weird)
// calls back with (error, roles_array) and self, previous, and null are tacked on as properties of the array
// NOTE: this needs a project token scoped in our system - this may vary depending on how the security is setup
Keystone.prototype.listRoles = (project_token, callback) => {
  var self = this;
  var request_options = this.getRequestOptions(project_token, '/roles', true);
  request_options.metricPath = 'remote-calls.keystone.roles.get';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'roles';

  this.request.get(request_options, (error, response, body) => {
    //console.log('roles', body);
    var n = 0;
    var roles_array = [];

    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (n = 0; n < body.roles.length; n++) {
      roles_array[n] = self.mangleObject('Role', body.roles[n]);
    }

    //tack these on for easy consupmtion and in case we ever need pagination
    roles_array.self = body.links.self;
    roles_array.previous = body.links.previous;
    roles_array.next = body.links.next;

    if (typeof callback === 'function') { callback(null, roles_array); }
    callback = undefined;
  });
};


// make a callback(error, assignments_array) with all of the role assignments for a project
// NOTE: this is only works if the user is authed as an admin or projectAdmin
Keystone.prototype.listRoleAssignments = (project_token, project_id, callback) => {
  var self = this;
  var request_options = this.getRequestOptions(project_token, '/role_assignments?scope.project.id=' + project_id, true);
  request_options.metricPath = 'remote-calls.keystone.role-assigments.list';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'role_assignments';

  this.request.get(request_options, (error, response, body) => {
    var callback_error = null;
    var assignments_array = [];
    var n = 0;

    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (n = 0; n < body.role_assignments.length; n++) {
      assignments_array[n] = self.mangleObject('RoleAssignment', body.role_assignments[n]);
    }

    //tack these on for easy consupmtion and in case we ever need pagination
    assignments_array.self = body.links.self;
    assignments_array.previous = body.links.previous;
    assignments_array.next = body.links.next;

    if (typeof callback === 'function') { callback(callback_error, assignments_array); }
    callback = undefined;
  });
};


// make a callback(error) after adding a specific role assignment to a project (either a user or a group)
// NOTE: this is only works if the user is authed as an admin or projectAdmin
Keystone.prototype.addRoleAssignment = (project_token, project_id, entry_id, entry_type, role_id, callback) => {
  var request_options = {};
  var entry_type_path = 'users';

  if (entry_type == 'group') {
    entry_type_path = 'groups';
  }

  request_options = this.getRequestOptions(project_token, '/projects/' + project_id + '/' + entry_type_path + '/' + entry_id + '/roles/' + role_id, true);
  request_options.metricPath = 'remote-calls.keystone.role-assignments.add';
  request_options.validateStatus = true;

  this.request.put(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    // else the body comes back as undefined instead of containing the new role assingment - lame
    // so just call back with no error and we should be good

    if (typeof callback === 'function') { callback(); }
    callback = undefined;
  });
};


// make a callback(error) after removing a specific role assignments on a project(either a user or a group)
// NOTE: this is only works if the user is authed as an admin or projectAdmin
Keystone.prototype.removeRoleAssignment = (project_token, project_id, entry_id, entry_type, role_id, callback) => {
  var request_options = {};
  var entry_type_path = 'users';

  if (entry_type == 'group') {
    entry_type_path = 'groups';
  }

  request_options = this.getRequestOptions(project_token, '/projects/' + project_id + '/' + entry_type_path + '/' + entry_id + '/roles/' + role_id, true);
  request_options.metricPath = 'remote-calls.keystone.role-assignments.remove';
  request_options.validateStatus = true;

  this.request.del(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    if (typeof callback === 'function') { callback(); }
    callback = undefined;
  });
};


// THE FOLLOWING ARE ONLY USEFUL WITHIN GODADDY (and are prioprietary functions until/if the project meta data work is adopted)
// THUS THEY AREN"T DOCUMENTED
// --------------------------------------------------------------------------
// make a callback(error) after retrieving all of the possible environments for the project/server meta data
// calls back with callback(error, environments_array)
Keystone.prototype.listMetaEnvironments = (auth_token, callback) => {
  var self = this;
  var request_options = {};
  var environments_array = [];
  var n = 0;

  request_options = this.getRequestOptions(auth_token, '/meta_values/environment', true);
  request_options.metricPath = 'remote-calls.keystone.meta-environments.get';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'environments';

  this.request.get(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (n = 0; n < body.environments.length; n++) {
      // this is a little silly since its just id/name but meh...
      environments_array[n] = self.mangleObject('MetaEnvironment', body.environments[n]);
    }

    if (typeof callback === 'function') { callback(null, environments_array); }
    callback = undefined;
  });
};


// make a callback(error) after retrieving all of the possible ownsers for the project/server meta data
// calls back with callback(error, owning_groups_array)
Keystone.prototype.listMetaOwningGroups = (auth_token, callback) => {
  var self                = this;
  var request_options     = {};
  var owning_groups_array = [];
  var n                   = 0;

  request_options = this.getRequestOptions(auth_token, '/meta_values/owning_group', true);
  request_options.metricPath = 'remote-calls.keystone.meta-owninggroups.get';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'owning_groups';

  this.request.get(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    for (n = 0; n < body.owning_groups.length; n++) {
      //this is a little silly since its just id/name but meh...
      owning_groups_array[n] = self.mangleObject('MetaOwningGroups', body.owning_groups[n]);
    }

    if (typeof callback === 'function') { callback(null, owning_groups_array); }
    callback = undefined;
  });
};


// make a callback(error) after listing all of the project meta data
// calls back with callback(error, meta_object)
Keystone.prototype.listProjectMeta = (project_token, project_id, callback) => {
  var self            = this;
  var request_options = {};
  var meta_object     = {};

  request_options = this.getRequestOptions(project_token, '/projects/' + project_id + '/meta', true);
  request_options.metricPath = 'remote-calls.keystone.projects.meta.get';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'meta';

  this.request.get(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    meta_object = self.mangleObject('ProjectMeta', body.meta);
    if (typeof callback === 'function') { callback(null, meta_object); }
    callback = undefined;
  });
};


// make a callback(error) after updating the project meta data
// meta_data should be an object with key-value pairs ie: {environment: 'dev', group: 'marketing'}
// calls back with callback(error, meta_object)
Keystone.prototype.updateProjectMeta = (project_token, project_id, new_meta, callback) => {
  var self            = this;
  var request_options = {};
  var meta_data       = {meta: new_meta}
  var meta_object     = {};

  request_options = this.getRequestOptions(project_token, '/projects/' + project_id + '/meta', meta_data);
  request_options.metricPath = 'remote-calls.keystone.projects.meta.update';
  request_options.validateStatus = true;
  request_options.requireBodyObject = 'meta';

  this.request.put(request_options, (error, response, body) => {
    if (error) {
      if (typeof callback === 'function') { callback(error); }
      callback = undefined;
      return;
    }

    meta_object = self.mangleObject('ProjectMeta', body.meta);
    if (typeof callback === 'function') { callback(null, meta_object); }
    callback = undefined;
  });
};

module.exports = Keystone;
