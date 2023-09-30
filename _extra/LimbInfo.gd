@tool
extends Node3D

@export var RUN := false

var knownVolumeInM := {
	"Head": 0.00701,
	"TorsoL": 0.0288,
	"Guts": 0.00701,
	"Neck": 0.000518,
	"TorsoU": 0.0728,
}

func _process(delta: float) -> void:
	if(not RUN):
		RUN = true
		# Size seems to be independant of scale of a parent object
		for child in self.get_children():
			var mesh : MeshInstance3D = child
			match child.name:
				"Head", "Guts", "Neck", "TorsoU", "TorsoL":
					var volume := mesh.mesh.get_aabb().get_volume()
					var volumeInM: float = knownVolumeInM[child.name]
					print(child.name+" "+str(volume)+" "+str(volumeInM))
					print(volumeInM/volume)

