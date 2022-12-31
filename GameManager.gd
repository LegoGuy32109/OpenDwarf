extends Node2D

@onready var rocks = $Rocks

func _ready():
	for rock in rocks.get_children():
		NavigationServer2D.agent_set_map(rock.get_node("NavObstacle").get_rid(), \
		get_world_2d().navigation_map)
		
