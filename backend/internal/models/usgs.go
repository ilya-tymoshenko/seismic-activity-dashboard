package models

type USGSFeatureCollection struct {
	Type     string        `json:"type"`
	Metadata interface{}   `json:"metadata"`
	Features []USGSFeature `json:"features"`
}

type USGSFeature struct {
	ID         string         `json:"id"`
	Type       string         `json:"type"`
	Properties USGSProperties `json:"properties"`
	Geometry   USGSGeometry   `json:"geometry"`
}

type USGSProperties struct {
	Mag     *float64 `json:"mag"`
	Place   string   `json:"place"`
	Time    int64    `json:"time"`
	Updated int64    `json:"updated"`
	Alert   *string  `json:"alert"`
	Tsunami int      `json:"tsunami"`
	Sig     int      `json:"sig"`
	Type    string   `json:"type"`
	MagType *string  `json:"magType"`
}

type USGSGeometry struct {
	Type        string    `json:"type"`
	Coordinates []float64 `json:"coordinates"`
}
