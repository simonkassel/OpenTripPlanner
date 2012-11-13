/* This program is free software: you can redistribute it and/or
   modify it under the terms of the GNU Lesser General Public License
   as published by the Free Software Foundation, either version 3 of
   the License, or (at your option) any later version.
   
   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.
   
   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <http://www.gnu.org/licenses/>. 
*/

otp.namespace("otp.modules.bikeshare");

otp.modules.bikeshare.StationModel = 
    Backbone.Model.extend({
    
    isWalkableFrom: function(point, tolerance) {
        return (Math.abs(this.get('x') - point.lng) < tolerance && 
                Math.abs(this.get('y') - point.lat) < tolerance);
    },
    
    isNearish: function(point, tolerance) {
        return (this.distanceTo(point) < tolerance && 
                parseInt(this.get('bikesAvailable')) > 0);
    },
    
    distanceTo: function(point) {
        var distance = otp.modules.bikeshare.Utils.distance;
        return distance(this.get('x'), this.get('y'), point.lng, point.lat);
    }
});

otp.modules.bikeshare.StationCollection = 
    Backbone.Collection.extend({
    
    url: otp.config.hostname + '/opentripplanner-api-webapp/ws/bike_rental',
    model: otp.modules.bikeshare.StationModel,
    
    sync: function(method, model, options) {
        options.dataType = 'jsonp';
        options.data = options.data || {};
        if(otp.config.routerId !== undefined) {
            options.data.routerId = otp.config.routerId;
        }
        return Backbone.sync(method, model, options);
    },
    
    parse: function(data, options) {
        var stations = _.pluck(data.stations, 'BikeRentalStation');
        return Backbone.Collection.prototype.parse.call(this, stations, options);
    }
});

otp.modules.bikeshare.Utils = {
    distance : function(x1, y1, x2, y2) {
        return Math.sqrt((x1-x2)*(x1-x2) + (y1-y2)*(y1-y2));
    }    
};

otp.modules.bikeshare.BikeShareModule = 
    otp.Class(otp.modules.planner.PlannerModule, {
    
    moduleName  : "Bike Share Planner",

    stations    : null,    
    stationLookup :   { },
    stationsLayer   : null,
     
    initialize : function(webapp) {
        otp.modules.planner.PlannerModule.prototype.initialize.apply(this, arguments);
    },
    
    activate : function() {
        if(this.activated) return;
        otp.modules.planner.PlannerModule.prototype.activate.apply(this);
        
        this.stationsLayer = new L.LayerGroup();
        this.addLayer("Bike Stations", this.stationsLayer);

        this.initStations();

        var this_ = this;
        setInterval(function() {
            this_.reloadStations();
        }, 30000);
       
    },

    planTripStart : function() {
//        this.resetStations();
    },
    
    processItinerary : function(itin, data) {
        for(var i=0; i < itin.legs.length; i++) {
            //console.log(itin);
            var polyline = new L.Polyline(otp.util.Polyline.decode(itin.legs[i].legGeometry.points));
            polyline.setStyle({ color : this.getModeColor(itin.legs[i].mode), weight: 8});
            this.pathLayer.addLayer(polyline);
            if(itin.legs[i].mode === 'BICYCLE') {
                if(data.mode === 'WALK,BICYCLE') { // bikeshare trip
                	polyline.bindPopup('Your '+otp.config.bikeshareName+' route!');
                    var start_and_end_stations = this.processStations(polyline.getLatLngs()[0], polyline.getLatLngs()[polyline.getLatLngs().length-1]);
                }
                else { // "my own bike" trip
                	polyline.bindPopup('Your bike route');
//                	this.resetStations();
                }	
            }
            else if(itin.legs[i].mode === 'WALK' && data.mode === 'WALK,BICYCLE') { 
                if(i == 0) {
                	polyline.bindPopup('Walk to the '+otp.config.bikeshareName+' dock.');
                }
                if(i == 2) {
                	polyline.bindPopup('Walk from the '+otp.config.bikeshareName+' dock to your destination.');
                }
            }
        }

        if(start_and_end_stations !== undefined && data.mode === 'WALK,BICYCLE') {
            if(start_and_end_stations['start'] !== null && start_and_end_stations['end'] !== null) {
           	    this.bikestationsWidget.setContentAndShow(
           	        start_and_end_stations['start'].toJSON(), 
           	        start_and_end_stations['end'].toJSON());
           	    this.bikestationsWidget.show();
           	}
           	else
           	    this.bikestationsWidget.hide();
        }
       	else {
       	    this.bikestationsWidget.hide();
       	}
    },
    
    
    processStations : function(start, end) {
        var this_ = this;
        var tol = .0005, distTol = .01;
        var start_and_end_stations = [];
        var distance = otp.modules.bikeshare.Utils.distance;
        
        this.stations.each(function(station) {
            var stationData = station.toJSON();
            
            if (station.isWalkableFrom(start, tol)) {
                // start station
                this.resetStationMarker(station, "PICK UP BIKE", this.icons.startBike);
                start_and_end_stations['start'] = station;
            }
            else if (station.isNearish(this.startLatLng, distTol)) {
                // start-adjacent station
                var distanceToStart = station.distanceTo(this.startLatLng);
                var icon = distanceToStart < distTol/2 ? this.icons.getLarge(stationData) : this.icons.getMedium(stationData);
                this.resetStationMarker(station, "ALTERNATE PICKUP", icon);
            }
            else if (station.isWalkableFrom(end, tol)) {
                // end station
                this.resetStationMarker(station, "DROP OFF BIKE", this.icons.endBike);
                start_and_end_stations['end'] = station;
            }
            else if (station.isNearish(this.endLatLng, distTol)) {
                // end-adjacent station
                var distanceToEnd = station.distanceTo(this.endLatLng);
                var icon = distanceToEnd < distTol/2 ? this.icons.getLarge(stationData) : this.icons.getMedium(stationData);
                this.resetStationMarker(station, "ALTERNATE DROP OFF", icon);
            }
            else {
                this.resetStationMarker(station);
            }
        }, this);
        
//        for(var i=0; i<this.stations.length; i++) {
//            var station = this.stations[i].BikeRentalStation;
//            if(Math.abs(station.x - start.lng) < tol && Math.abs(station.y - start.lat) < tol) {
//                // start station
//                this.stationsLayer.removeLayer(station.marker);                        
//                var marker = new L.Marker(station.marker.getLatLng(), {icon: this.icons.startBike});
//                marker.bindPopup(this.constructStationInfo("PICK UP BIKE", station));
//                this.stationsLayer.addLayer(marker);
//                station.marker = marker;
//                start_and_end_stations['start'] = station;
//            }
//            else if(this.distance(station.x, station.y, this.startLatLng.lng, this.startLatLng.lat) < distTol && 
//                    parseInt(station.bikesAvailable) > 0) {
//                // start-adjacent station
//                this.stationsLayer.removeLayer(station.marker);
//                              
//                var icon = this.distance(station.x, station.y, this.startLatLng.lng, this.startLatLng.lat) < distTol/2 ?  this.icons.getLarge(station) : this.icons.getMedium(station);
//                var marker = new L.Marker(station.marker.getLatLng(), { icon: icon }); 
//                marker.bindPopup(this.constructStationInfo("ALTERNATE PICKUP", station));
//                this.stationsLayer.addLayer(marker);                        
//                station.marker = marker;
//            }
//            else if(Math.abs(station.x - end.lng) < tol && Math.abs(station.y - end.lat) < tol) {
//                // end station
//                this.stationsLayer.removeLayer(station.marker);                        
//                var marker = new L.Marker(station.marker.getLatLng(), {icon: this.icons.endBike});
//                marker.bindPopup(this.constructStationInfo("DROP OFF BIKE", station));
//                this.stationsLayer.addLayer(marker);
//                station.marker = marker;
//                start_and_end_stations['end'] = station;
//            }
//            else if(this.distance(station.x, station.y, this.endLatLng.lng, this.endLatLng.lat) < distTol && 
//                    parseInt(station.bikesAvailable) > 0) {
//                // end-adjacent station
//                this.stationsLayer.removeLayer(station.marker);                        

//                var icon = this.distance(station.x, station.y, this.endLatLng.lng, this.endLatLng.lat) < distTol/2 ?  this.icons.getLarge(station) : this.icons.getMedium(station);
//                var marker = new L.Marker(station.marker.getLatLng(), {icon: icon}); 
//                marker.bindPopup(this.constructStationInfo("ALTERNATE DROP OFF", station));
//                this.stationsLayer.addLayer(marker);                        
//                station.marker = marker;
//            }
//            else {
//                this.stationsLayer.removeLayer(station.marker);                        
//                var marker = new L.Marker(station.marker.getLatLng(), {icon: this.icons.getSmall(station)}); 
//                marker.bindPopup(this.constructStationInfo("BIKE STATION", station));
//                this.stationsLayer.addLayer(marker);                        
//                station.marker = marker;
//            }
//        }
        
        return start_and_end_stations;
    },
    
    onResetStations : function(stations) {
        this.reresetStationMarkers();
    },
    
    reresetStationMarkers : function() {
        this.clearStationMarkers();
        this.stations.each(function(station) {
            this.addStationMarker(station); }, this);
    },

    clearStationMarkers : function() {
        _.each(_.keys(this.markers), function(stationId) {
            this.removeStationMarker(stationId); }, this);
    },
    
    removeStationMarker : function(stationId) {
        var marker = this.markers[stationId];
        this.stationsLayer.removeLayer(marker);
    },
    
    addStationMarker : function(station, title, icon) {
        var stationData = station.toJSON(),
            marker;
        
        icon = icon || this.icons.getSmall(stationData);
        
        marker = new L.Marker(new L.LatLng(stationData.y, stationData.x), {icon: icon});
        marker.bindPopup(this.constructStationInfo(title, stationData));
        this.markers[station.id] = marker;
        this.stationsLayer.addLayer(marker);
    },
    
    resetStationMarker : function(station, title, icon) {
        if (station.id in this.markers) {
            this.removeStationMarker(station.id);
        }
        this.addStationMarker(station, title, icon)
    },
    
    initStations : function() {
        //console.log('init stations');
        this.markers = {};
        this.stations = new otp.modules.bikeshare.StationCollection();
        this.stations.on('reset', this.onResetStations, this);
        
        this.stations.fetch();
    },

    reloadStations : function(stations) {
        //console.log('update stations');
        this.stations.fetch();
    },
            
    constructStationInfo : function(title, station) {
        if(title == null) {
            title = (station.markerTitle !== undefined) ? station.markerTitle : "BIKE STATION";
        }
        var info = "<strong>"+title+"</strong><br/>";
        station.markerTitle = title;
        info += '<strong>Station:</strong> '+station.name+'<br/>';
        info += '<strong>Bikes Available:</strong> '+station.bikesAvailable+'<br/>';
        info += '<strong>Docks Available:</strong> '+station.spacesAvailable+'<br/>';
        return info;
    },
                
    CLASS_NAME : "otp.modules.bikeshare.BikeShareModule"
});
