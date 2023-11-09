extends Node

@export_dir var organDataFilePath: String = "res://Game/Creature/templates"
@export var fileName: String = "human_male_template.json"

# returns root of body, "brain" 🧠
func constructHuman() -> Organ:
	var brain = Organ.new({"isInternal": true, "id": "Brain", "volume": 0.00127387943212, "weight": 1.37})
	var head = Organ.new({"id": "Head", "volume": 0.04119239747524, "weight": 5.5})
	var eyeR = Organ.new({"id": "EyeR", "name": "Right Eye", "volume": 0.0000923661064, "weight": 0.0075})
	var eyeL = Organ.new({"id": "EyeL", "name": "Left Eye", "volume": 0.0000923661064, "weight": 0.0075})
	var earR = Organ.new({"id": "EarR", "name": "Right Ear", "volume": 0.00010917393956, "weight": 0.0014})
	var earL = Organ.new({"id": "EarL", "name": "Left Ear", "volume": 0.00010917393956, "weight": 0.0014})
	var mouth = Organ.new({"id": "Mouth", "volume": 0.00026071682805, "weight": 0.025})
	var nose = Organ.new({"id": "Nose", "volume": 0.00007716972323, "weight": 0.008})
	
	var neck = Organ.new({"id": "Neck", "volume": 0.00051674747374, "weight": 3})
	var torsoU = Organ.new({"id": "TorsoU", "name": "Upper Torso", "volume": 0.07289374619722, "weight": 15})
	var heart = Organ.new({"isHeart": true, "id": "Heart", "volume": 0.00061203143559, "weight": 0.35})
	var lungR = Organ.new({"id": "LungR", "name": "Right Lung", "volume": 0.00409334106371, "weight": 1.05})
	var lungL = Organ.new({"id": "LungL", "name": "Left Lung", "volume": 0.00409334525466, "weight": 1.05})
	var stomach = Organ.new({"id": "Stomach", "volume": 0.00044758911827, "weight": 1.75})
	var liver = Organ.new({"id": "Liver", "volume": 0.00147630751599, "weight": 1.5})
	var spleen = Organ.new({"id": "Spleen", "volume": 0.00014384483802, "weight": 0.175})
	var pancreas = Organ.new({"id": "Pancreas", "volume":  0.00009726657299, "weight": 0.085})
	
	var armRU = Organ.new({"limbName": "Right Arm", "id": "ArmRU", "name": "Right Upper Arm", "volume": 0.00300435884856, "weight": 3})
	var armRL = Organ.new({"limbName": "Right Arm", "id": "ArmRL", "name": "Right Lower Arm", "volume": 0.003882199293, "weight": 1.9})
	var handR = Organ.new({"limbName": "Right Arm", "id": "HandR", "name": "Right Hand", "volume": 0.00218579918146, "weight": 0.25})
	var thumbR = Organ.new({"limbName": "Right Arm", "id": "ThumbR", "name": "Right Thumb", "volume": 0.00009846345347, "weight": 0.015})
	var fingerR1 = Organ.new({"limbName": "Right Arm", "id": "FingerR1", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerR3 = Organ.new({"limbName": "Right Arm", "id": "FingerR3", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerR2 = Organ.new({"limbName": "Right Arm", "id": "FingerR2", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerR4 = Organ.new({"limbName": "Right Arm", "id": "FingerR4", "name": "Pinky", "volume": 0.00015331352188, "weight": 0.0075})
	
	var armLU = Organ.new({"limbName": "Left Arm", "id": "ArmLU", "name": "Left Upper Arm", "volume": 0.00300435884856, "weight": 3})
	var armLL = Organ.new({"limbName": "Left Arm", "id": "ArmLL", "name": "Left Lower Arm", "volume": 0.003882199293, "weight": 1.9})
	var handL = Organ.new({"limbName": "Left Arm", "id": "HandL", "name": "Left Hand", "volume": 0.00218579918146, "weight": 0.25})
	var thumbL = Organ.new({"limbName": "Left Arm", "id": "ThumbL", "name": "Left Thumb", "volume": 0.00009846345347, "weight": 0.015})
	var fingerL1 = Organ.new({"limbName": "Left Arm", "id": "FingerL1", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerL2 = Organ.new({"limbName": "Left Arm", "id": "FingerL2", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerL3 = Organ.new({"limbName": "Left Arm", "id": "FingerL3", "name": "Finger", "volume": 0.00015331352188, "weight": 0.0075})
	var fingerL4 = Organ.new({"limbName": "Left Arm", "id": "FingerL4", "name": "Pinky", "volume": 0.00015331352188, "weight": 0.0075})
	
	var torsoL = Organ.new({"id": "TorsoL", "name": "Lower Torso", "volume": 0.02879198081791, "weight": 20})
	var kidneyL = Organ.new({"id": "Left Kidney", "volume": 0.00014577648835, "weight": 0.145})
	var kidneyR = Organ.new({"id": "Right Kidney", "volume": 0.00013417842274, "weight": 0.145})
	var guts = Organ.new({"id": "Guts", "volume": 0.00700118485838, "weight": 1.5})
	
	var legRU = Organ.new({"limbName": "Right Leg", "id": "LegRU", "name": "Right Upper Leg", "volume": 0.00600656634197, "weight": 12.5})
	var legRL = Organ.new({"limbName": "Right Leg", "id": "LegRL", "name": "Right Lower Leg", "volume": 0.00980964675546, "weight": 5})
	var footR = Organ.new({"limbName": "Right Leg", "id": "FootR", "name": "Right Foot", "volume": 0.00232410663739, "weight": 1.25})
	var toeR1 = Organ.new({"limbName": "Right Leg", "id": "ToeR1", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeR2 = Organ.new({"limbName": "Right Leg", "id": "ToeR2", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeR3 = Organ.new({"limbName": "Right Leg", "id": "ToeR3", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeR4 = Organ.new({"limbName": "Right Leg", "id": "ToeR4", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeR5 = Organ.new({"limbName": "Right Leg", "id": "ToeR5", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	
	var legLU = Organ.new({"limbName": "Left Leg", "id": "LegLU", "name": "Left Upper Leg", "volume": 0.00600656680763, "weight": 12.5})
	var legLL = Organ.new({"limbName": "Left Leg", "id": "LegLL", "name": "Left Lower Leg", "volume": 0.00980964768678, "weight": 5})
	var footL = Organ.new({"limbName": "Left Leg", "id": "FootL", "name": "Left Foot", "volume": 0.00232410663739, "weight": 1.25})
	var toeL2 = Organ.new({"limbName": "Left Leg", "id": "ToeL1", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeL1 = Organ.new({"limbName": "Left Leg", "id": "ToeL2", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeL3 = Organ.new({"limbName": "Left Leg", "id": "ToeL3", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeL4 = Organ.new({"limbName": "Left Leg", "id": "ToeL4", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	var toeL5 = Organ.new({"limbName": "Left Leg", "id": "ToeL5", "name": "Toe", "volume": 0.00002738583316, "weight": 0.002})
	
	# Brain, Head, Neck, [Torso], [Arm], [Hand], [Leg], [Foot]
	var humanCritical = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
		"artery": 1.0,
		"type": Connection.TYPE.EXTERNAL,
	}
	# Eye, Mouth, Finger, Thumb, Toe
	var humanExtremity = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
		"type": Connection.TYPE.EXTERNAL,
	}
	# Ear, Nose
	var humanMayWiggle = {
		"tissue": 1.0,
		"muscle": 0.2, # influence by genetics or random chance
		"nerve": 1.0,
		"type": Connection.TYPE.EXTERNAL,
	}
	# Stomach, Liver, Spleen, Pancreas
	var humanOrgan = {
		"tissue": 1.0,
		"type": Connection.TYPE.INTERNAL,
	}
	# Heart, Lung, Guts
	var humanMuscleOrgan = { 
		"tissue": 1.0,
		"muscle": 1.0,
		"artery": 1.0,
		"type": Connection.TYPE.INTERNAL,
	}
	
	# start connecting from root of the creature, the brain
	brain.connectOrgan(head, humanCritical)
	
	# each organ has it's own block of connecting other organs
	head.connectOrgan(eyeR, humanExtremity)
	head.connectOrgan(eyeL, humanExtremity)
	head.connectOrgan(earR, humanMayWiggle)
	head.connectOrgan(earL, humanMayWiggle)
	head.connectOrgan(nose, humanMayWiggle)
	head.connectOrgan(mouth, humanExtremity)
	head.connectOrgan(neck, humanCritical)
	
	neck.connectOrgan(torsoU, humanCritical)
	
	torsoU.connectOrgan(heart, humanMuscleOrgan)
	torsoU.connectOrgan(lungR, humanMuscleOrgan)
	torsoU.connectOrgan(lungL, humanMuscleOrgan)
	torsoU.connectOrgan(stomach, humanOrgan)
	torsoU.connectOrgan(liver, humanOrgan)
	torsoU.connectOrgan(spleen, humanOrgan)
	torsoU.connectOrgan(pancreas, humanOrgan)
	torsoU.connectOrgan(armRU, humanCritical)
	torsoU.connectOrgan(armLU, humanCritical)
	torsoU.connectOrgan(torsoL, humanCritical)
	
	armRU.connectOrgan(armRL, humanCritical)
	
	armRL.connectOrgan(handR, humanCritical)
	
	handR.connectOrgan(thumbR, humanExtremity)
	handR.connectOrgan(fingerR1, humanExtremity)
	handR.connectOrgan(fingerR2, humanExtremity)
	handR.connectOrgan(fingerR3, humanExtremity)
	handR.connectOrgan(fingerR4, humanExtremity)
	
	armLU.connectOrgan(armLL, humanCritical)
	
	armLL.connectOrgan(handL, humanCritical)
	
	handL.connectOrgan(thumbL, humanExtremity)
	handL.connectOrgan(fingerL1, humanExtremity)
	handL.connectOrgan(fingerL2, humanExtremity)
	handL.connectOrgan(fingerL3, humanExtremity)
	handL.connectOrgan(fingerL4, humanExtremity)
	
	torsoL.connectOrgan(guts, humanMuscleOrgan)
	torsoL.connectOrgan(kidneyR, humanOrgan)
	torsoL.connectOrgan(kidneyL, humanOrgan)
	torsoL.connectOrgan(legRU, humanCritical)
	torsoL.connectOrgan(legLU, humanCritical)
	
	legRU.connectOrgan(legRL, humanCritical)
	
	legRL.connectOrgan(footR, humanCritical)

	footR.connectOrgan(toeR1, humanExtremity)
	footR.connectOrgan(toeR2, humanExtremity)
	footR.connectOrgan(toeR3, humanExtremity)
	footR.connectOrgan(toeR4, humanExtremity)
	footR.connectOrgan(toeR5, humanExtremity)
	
	legLU.connectOrgan(legLL, humanCritical)
	
	legLL.connectOrgan(footL, humanCritical)
	
	footL.connectOrgan(toeL1, humanExtremity)
	footL.connectOrgan(toeL2, humanExtremity)
	footL.connectOrgan(toeL3, humanExtremity)
	footL.connectOrgan(toeL4, humanExtremity)
	footL.connectOrgan(toeL5, humanExtremity)
	
	return brain

func _ready() -> void:
	print("\n==Starting Organ Test==\n")
	var humanBrain: Organ = constructHuman()
	
	var body = Body.new({"rootOrgan": humanBrain}) # why green?
	
	var xmlParser = XMLData.new()
	xmlParser.readBodyFile("res://File IO/xmlTest.xml")
	
	print("hi")
	
#	var file = FileAccess.open("%s/%s" % [organDataFilePath, fileName], FileAccess.WRITE)
#	file.store_string(bodyDataString)
#	file.close()
	
#	var humanFactory = EntityFactory.new(EntityFactory.SPECIES.HUMAN_MALE)
