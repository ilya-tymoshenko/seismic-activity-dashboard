package models

import "time"

type Earthquake struct {
	ID        string     `json:"id" gorm:"primaryKey;column:id"`
	Time      time.Time  `json:"time" gorm:"column:time"`
	Updated   time.Time  `json:"updated" gorm:"column:updated"`
	Latitude  float64    `json:"latitude" gorm:"column:latitude"`
	Longitude float64    `json:"longitude" gorm:"column:longitude"`
	Depth     *float64   `json:"depth" gorm:"column:depth"`
	Magnitude *float64   `json:"magnitude" gorm:"column:magnitude"`
	MagType   *string    `json:"magType" gorm:"column:mag_type"`
	Place     string     `json:"place" gorm:"column:place"`
	Alert     *string    `json:"alert" gorm:"column:alert"`
	Tsunami   int        `json:"tsunami" gorm:"column:tsunami"`
	Sig       int        `json:"sig" gorm:"column:sig"`
	Type      string     `json:"type" gorm:"column:type"`
	Source    string     `json:"source" gorm:"column:source"`
	Ingested  *time.Time `json:"ingestedAt" gorm:"column:ingested_at"`
}

func (Earthquake) TableName() string {
	return "earthquakes"
}
