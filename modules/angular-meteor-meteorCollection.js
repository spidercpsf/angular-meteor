'use strict';

var angularMeteorCollections = angular.module('angular-meteor.meteor-collection',
  ['angular-meteor.subscribe', 'angular-meteor.utils', 'diffArray']);


var AngularMeteorCollection = function (cursor, $q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout) {

  var self = [];
  self._serverBackup = [];

  self.__proto__ = AngularMeteorCollection.prototype;
  self.__proto__.$q = $q;
  self.__proto__.$meteorSubscribe = $meteorSubscribe;
  self.__proto__.$rootScope = $rootScope;
  self.__proto__.$timeout = $timeout;

  self.$$collection = $meteorUtils.getCollectionByName(cursor.collection.name);

  return self;
};

AngularMeteorCollection.prototype = [];

AngularMeteorCollection.prototype.subscribe = function () {
  var self = this;
  self.$meteorSubscribe.subscribe.apply(this, arguments);
  return this;
};

AngularMeteorCollection.prototype.save = function save(docs, useUnsetModifier) {
  var self = this,
    collection = self.$$collection,
    $q = self.$q,
    promises = []; // To store all promises.

  /*
   * The upsertObject function will either update an object if the _id exists
   * or insert an object if the _id is not set in the collection.
   * Returns a promise.
   */
  function upsertObject(item, $q) {
    var deferred = $q.defer();

    item = angular.copy(item);

    if (item._id) { // Performs an update if the _id property is set.
      var item_id = item._id; // Store the _id in temporary variable
      delete item._id; // Remove the _id property so that it can be $set using update.
      var objectId = (item_id._str) ? new Meteor.Collection.ObjectID(item_id._str) : item_id;
      var modifier = (useUnsetModifier) ? {$unset: item} : {$set: item};

      collection.update(objectId, modifier, function (error) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: objectId, action: "updated"});
        }
      });
    } else { // Performs an insert if the _id property isn't set.
      collection.insert(item, function (error, result) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: result, action: "inserted"});
        }
      });
    }

    return deferred.promise;
  }

  /*
   * How to update the collection depending on the 'docs' argument passed.
   */
  if (docs) { // Checks if a 'docs' argument was passed.
    if (angular.isArray(docs)) { // If an array of objects were passed.
      angular.forEach(docs, function (doc) {
        this.push(upsertObject(doc, $q));
      }, promises);
    } else { // If a single object was passed.
      promises.push(upsertObject(docs, $q));
    }
  } else { // If no 'docs' argument was passed, save the entire collection.
    angular.forEach(self, function (doc) {
      this.push(upsertObject(doc, $q));
    }, promises);
  }

  return $q.all(promises); // Returns all promises when they're resolved.
};

AngularMeteorCollection.prototype.remove = function remove(keys) {
  var self = this,
    collection = self.$$collection,
    $q = self.$q,
    promises = []; // To store all promises.

  /*
   * The removeObject function will delete an object with the _id property
   * equal to the specified key.
   * Returns a promise.
   */
  function removeObject(key, $q) {
    var deferred = $q.defer();

    if (key) { // Checks if 'key' argument is set.
      if (key._id) {
        key = key._id;
      }
      var objectId = (key._str) ? new Meteor.Collection.ObjectID(key._str) : key;

      collection.remove(objectId, function (error) {
        if (error) {
          deferred.reject(error);
        } else {
          deferred.resolve({_id: objectId, action: "removed"});
        }
      });
    } else {
      deferred.reject("key cannot be null");
    }

    return deferred.promise;
  }

  /*
   * What to remove from collection depending on the 'keys' argument passed.
   */
  if (keys) { // Checks if a 'keys' argument was passed.
    if (angular.isArray(keys)) { // If an array of keys were passed.
      angular.forEach(keys, function (key) {
        this.push(removeObject(key, $q));
      }, promises);
    } else { // If a single key was passed.
      promises.push(removeObject(keys, $q));
    }
  } else { // If no 'keys' argument was passed, save the entire collection.
    // When removing all, we do not use collection.remove({}) because Meteor doesn't give the client side that permissions
    // http://stackoverflow.com/a/15465286/1426570
    var originalSelf = angular.copy(self);
    angular.forEach(originalSelf, function (doc) {
      this.push(removeObject(doc._id, $q));
    }, promises);
  }

  return $q.all(promises); // Returns all promises when they're resolved.
};

AngularMeteorCollection.prototype.updateCursor = function (cursor) {
  var self = this,
    $rootScope = self.$rootScope,
    $timeout = self.$timeout;

  var promise;
  // Function applies async to combine multiple operations (savings, deletions etc)
  // in one processing.
  function safeApply() {
    if (promise) {
      $timeout.cancel(promise);
      promise = null;
    }
    // Clearing the watch is needed so no updates are sent to server
    // while handling updates from the server
    self.UPDATING_FROM_SERVER = true;
    promise = $timeout(function () {
      $rootScope.$apply();
      self.UPDATING_FROM_SERVER = false;
      $rootScope.$apply();
    }, 0, false);
  }

  // XXX - consider adding an option for a non-orderd result
  // for faster performance
  if (self.observeHandle) {
    self.observeHandle.stop();
  }

  self.observeHandle = cursor.observe({
    addedAt: function (document, atIndex) {
      self.splice(atIndex, 0, document);
      self._serverBackup.splice(atIndex, 0, document);
      safeApply();
    },
    changedAt: function (document, oldDocument, atIndex) {
      self.splice(atIndex, 1, document);
      self._serverBackup.splice(atIndex, 1, document);
      safeApply();
    },
    movedTo: function (document, fromIndex, toIndex) {
      self.splice(fromIndex, 1);
      self.splice(toIndex, 0, document);
      self._serverBackup.splice(fromIndex, 1);
      self._serverBackup.splice(toIndex, 0, document);
      safeApply();
    },
    removedAt: function (oldDocument) {
      var removedObject;
      if (oldDocument._id._str){
        removedObject = _.find(self, function(obj) {
          return obj._id._str == oldDocument._id._str;
        });
      }
      else
        removedObject = _.findWhere(self, {_id: oldDocument._id});

      if (removedObject){
        self.splice(self.indexOf(removedObject), 1);
        self._serverBackup.splice(self.indexOf(removedObject), 1);
        safeApply();
      }
    }
  });
};

AngularMeteorCollection.prototype.stop = function () {
  if (this.unregisterAutoBind)
    this.unregisterAutoBind();

  if (this.observeHandle)
    this.observeHandle.stop();

  while (this.length > 0) {
    this.pop();
    this._serverBackup.pop();
  }
};


angularMeteorCollections.factory('$meteorCollection', ['$q', '$meteorSubscribe', '$meteorUtils', '$rootScope', '$timeout', 'diffArray',
  function ($q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout, diffArray) {
    return function (reactiveFunc, auto) {
      // Validate parameters
      if (!reactiveFunc) {
        throw new TypeError("The first argument of $meteorCollection is undefined.");
      }
      if (!(typeof reactiveFunc == "function" || reactiveFunc instanceof Mongo.Collection)) {
        throw new TypeError("The first argument of $meteorCollection must be a function or a Mongo.Collection.");
      }
      auto = auto !== false;

      if (reactiveFunc instanceof Mongo.Collection) {
        var collection = reactiveFunc;
        reactiveFunc = function() {
          return collection.find({});
        }
      }

      var ngCollection = new AngularMeteorCollection(reactiveFunc(), $q, $meteorSubscribe, $meteorUtils, $rootScope, $timeout);

      function setAutoBind() {
        if (auto) { // Deep watches the model and performs autobind.
          ngCollection.unregisterAutoBind = $rootScope.$watch(function () {
            if (ngCollection.UPDATING_FROM_SERVER) {
              return 'UPDATING_FROM_SERVER';
            }
            return _.without(ngCollection, 'UPDATING_FROM_SERVER');
          }, function (newItems, oldItems) {
            if (newItems == 'UPDATING_FROM_SERVER')
              return;

            if (oldItems == 'UPDATING_FROM_SERVER')
              oldItems = ngCollection._serverBackup;


            if (newItems !== oldItems) {

              var addedCount = 0;
              diffArray(oldItems, newItems, {
                addedAt: function (id, item, index) {
                  ngCollection.unregisterAutoBind();
                  var newValue = ngCollection.splice( index - addedCount, 1 ).pop();
                  setAutoBind();
                  ngCollection.save(newValue);
                  addedCount++;
                },
                removedAt: function (id, item, index) {
                  ngCollection.remove(id);
                },
                changedAt: function (id, setDiff, unsetDiff, index, oldItem) {

                  if (setDiff)
                    ngCollection.save(setDiff);

                  if (unsetDiff)
                    ngCollection.save(unsetDiff, true);
                },
                movedTo: function (id, item, fromIndex, toIndex) {
                  // XXX do we need this?
                }
              });
            }
          }, true);
        }
      }

      /**
       * Fetches the latest data from Meteor and update the data variable.
       */
      Tracker.autorun(function () {
        // When the reactive func gets recomputated we need to stop any previous
        // observeChanges
        Tracker.onInvalidate(function () {
          ngCollection.stop();
        });
        ngCollection.updateCursor(reactiveFunc());
        setAutoBind();
      });

      return ngCollection;
    }
  }]);
