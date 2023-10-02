extends Node

# this will be fixed in next release
#const Constants = preload("res://Game/Creature/Limb.gd")
enum ConnectionToHeart {NONE, CONNECTED, DISCONNECTED}

# Function must be run after attaching limbs together to autocomplete variables
func completeBody(
	limb: Limb, printToConsole: bool = false, levelsDeep = 0
) -> void:
	# print legend if printing information to console
	if (printToConsole && levelsDeep == 0):
		print("Legend\nBRAIN 🧠\nORGAN 🫁\nHEART 🫀\nNEEDS BLOOD 🩸\n")
	
	var depth = ""
	for i in range(levelsDeep):
		depth += "-"
	
	var isBrain = ""
	if(levelsDeep == 0):
		isBrain = "🧠"
	
	var isOrgan = ""
	if(limb.findIfOrgan()):
		isOrgan = "🫁"
	
	var isHeart = ""
	if(limb.isHeart):
		isHeart = "🫀"
	
	var needsBlood = ""
	limb.currentHeartConnection = limb.connectedToHeart()
	match (limb.currentHeartConnection):
		ConnectionToHeart.CONNECTED:
			needsBlood = "🩸"
		ConnectionToHeart.NONE:
			# Just a normal limb
			needsBlood = ""
		ConnectionToHeart.DISCONNECTED:
			needsBlood="❌🩸"
		var newCase:
			needsBlood=" new heartConnection case:"+str(newCase)
	
	if (printToConsole):
		print(depth+limb.name+" "+isBrain+isHeart+isOrgan+needsBlood)
		print(depth+str(limb.volume)+" m^3")
	for connection in limb.connections:
		completeBody(connection.linkTo, printToConsole, levelsDeep+1)

# returns root of body, "brain" 🧠
func constructHuman() -> Limb:
	var brain = Limb.new("Brain", 0.00127387943212)
	var head = Limb.new("Head", 0.04119239747524)
	var eyeR = Limb.new("Right Eye", 0.0000923661064)
	var eyeL = Limb.new("Left Eye", 0.0000923661064)
	var earR = Limb.new("Right Ear", 0.00010917393956)
	var earL = Limb.new("Left Ear", 0.00010917393956)
	var mouth = Limb.new("Mouth", 0.00026071682805)
	var nose = Limb.new("Nose", 0.00007716972323)
	
	var neck = Limb.new("Neck", 0.00051674747374)
	var torsoU = Limb.new("Upper Torso", 0.07289374619722)
	var heart = Limb.new("Heart", 0.00061203143559)
	var lungR = Limb.new("Right Lung", 0.00409334106371)
	var lungL = Limb.new("Left Lung", 0.00409334525466)
	var stomach = Limb.new("Stomach", 0.00044758911827)
	var liver = Limb.new("Liver", 0.00147630751599)
	var spleen = Limb.new("Spleen", 0.00014384483802)
	var pancreas = Limb.new("Pancreas", 0.00009726657299)
	
	var armRU = Limb.new("Right Upper Arm", 0.00300435884856)
	var armRL = Limb.new("Right Lower Arm", 0.003882199293)
	var handR = Limb.new("Right Hand", 0.00218579918146)
	var thumbR = Limb.new("Right Thumb", 0.00009846345347)
	var fingerR1 = Limb.new("Finger", 0.00015331352188)
	var fingerR2 = Limb.new("Finger", 0.00015331352188)
	var fingerR3 = Limb.new("Finger", 0.00015331352188)
	var fingerR4 = Limb.new("Pinky", 0.00015331352188)
	
	var armLU = Limb.new("Left Upper Arm", 0.00300435884856)
	var armLL = Limb.new("Left Lower Arm", 0.003882199293)
	var handL = Limb.new("Left Hand", 0.00218579918146)
	var thumbL = Limb.new("Left Thumb", 0.00009846345347)
	var fingerL1 = Limb.new("Finger", 0.00015331352188)
	var fingerL2 = Limb.new("Finger", 0.00015331352188)
	var fingerL3 = Limb.new("Finger", 0.00015331352188)
	var fingerL4 = Limb.new("Pinky", 0.00015331352188)
	
	var torsoL = Limb.new("Lower Torso", 0.02879198081791)
	var kidneyL = Limb.new("Left Kidney", 0.00014577648835)
	var kidneyR = Limb.new("Right Kidney", 0.00013417842274)
	var guts = Limb.new("Guts", 0.00700118485838)
	
	var legRU = Limb.new("Right Upper Leg", 0.00600656634197)
	var legRL = Limb.new("Right Lower Leg", 0.00980964675546)
	var footR = Limb.new("Right Foot", 0.00232410663739)
	var toeR1 = Limb.new("Toe", 0.00002738583316)
	var toeR2 = Limb.new("Toe", 0.00002738583316)
	var toeR3 = Limb.new("Toe", 0.00002738583316)
	var toeR4 = Limb.new("Toe", 0.00002738583316)
	var toeR5 = Limb.new("Toe", 0.00002738583316)
	
	var legLU = Limb.new("Left Upper Leg", 0.00600656680763)
	var legLL = Limb.new("Left Lower Leg", 0.00980964768678)
	var footL = Limb.new("Left Foot", 0.00232410663739)
	var toeL1 = Limb.new("Toe", 0.00002738583316)
	var toeL2 = Limb.new("Toe", 0.00002738583316)
	var toeL3 = Limb.new("Toe", 0.00002738583316)
	var toeL4 = Limb.new("Toe", 0.00002738583316)
	var toeL5 = Limb.new("Toe", 0.00002738583316)
	
	# Brain, Neck, [Torso], [Arm], [Hand], [Leg], [Foot]
	var humanCritical = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
		"artery": 1.0,
	}
	# Eye, Mouth, Finger, Thumb, Toe
	var humanExtremity = {
		"tissue": 1.0,
		"muscle": 1.0,
		"nerve": 1.0,
	}
	# Ear, Nose
	var humanMayWiggle = {
		"tissue": 1.0,
		"muscle": 0.2, # influence by genetics or random chance
		"nerve": 1.0,
	}
	# Stomach, Liver, Spleen, Pancreas
	var humanOrgan = {
		"tissue": 1.0,
	}
	# Heart, Lung, Guts
	var humanMuscleOrgan = { 
		"tissue": 1.0,
		"muscle": 1.0,
		"artery": 1.0,
	}
	
	# start connecting from root of the creature, the brain
	brain.isBrainOf(head, humanCritical)
	
	# each limb has it's own block of connecting other limbs
	head.connectLimb(eyeR, humanExtremity)
	head.connectLimb(eyeL, humanExtremity)
	head.connectLimb(earR, humanMayWiggle)
	head.connectLimb(earL, humanMayWiggle)
	head.connectLimb(nose, humanMayWiggle)
	head.connectLimb(mouth, humanExtremity)
	head.connectLimb(neck, humanCritical)
	
	neck.connectLimb(torsoU, humanCritical)
	
	heart.isHeart = true
	torsoU.connectOrgan(heart, humanMuscleOrgan)
	torsoU.connectOrgan(lungR, humanMuscleOrgan)
	torsoU.connectOrgan(lungL, humanMuscleOrgan)
	torsoU.connectOrgan(stomach, humanOrgan)
	torsoU.connectOrgan(liver, humanOrgan)
	torsoU.connectOrgan(spleen, humanOrgan)
	torsoU.connectOrgan(pancreas, humanOrgan)
	torsoU.connectLimb(armRU, humanCritical)
	torsoU.connectLimb(armLU, humanCritical)
	torsoU.connectLimb(torsoL, humanCritical)
	
	armRU.connectLimb(armRL, humanCritical)
	
	armRL.connectLimb(handR, humanCritical)
	
	handR.connectLimb(thumbR, humanExtremity)
	handR.connectLimb(fingerR1, humanExtremity)
	handR.connectLimb(fingerR2, humanExtremity)
	handR.connectLimb(fingerR3, humanExtremity)
	handR.connectLimb(fingerR4, humanExtremity)
	
	armLU.connectLimb(armLL, humanCritical)
	
	armLL.connectLimb(handL, humanCritical)
	
	handL.connectLimb(thumbL, humanExtremity)
	handL.connectLimb(fingerL1, humanExtremity)
	handL.connectLimb(fingerL2, humanExtremity)
	handL.connectLimb(fingerL3, humanExtremity)
	handL.connectLimb(fingerL4, humanExtremity)
	
	torsoL.connectOrgan(guts, humanMuscleOrgan)
	torsoL.connectOrgan(kidneyR, humanOrgan)
	torsoL.connectOrgan(kidneyL, humanOrgan)
	torsoL.connectLimb(legRU, humanCritical)
	torsoL.connectLimb(legLU, humanCritical)
	
	legRU.connectLimb(legRL, humanCritical)
	
	legRL.connectLimb(footR, humanCritical)

	footR.connectLimb(toeR1, humanExtremity)
	footR.connectLimb(toeR2, humanExtremity)
	footR.connectLimb(toeR3, humanExtremity)
	footR.connectLimb(toeR4, humanExtremity)
	footR.connectLimb(toeR5, humanExtremity)
	
	legLU.connectLimb(legLL, humanCritical)
	
	legLL.connectLimb(footL, humanCritical)
	
	footL.connectLimb(toeL1, humanExtremity)
	footL.connectLimb(toeL2, humanExtremity)
	footL.connectLimb(toeL3, humanExtremity)
	footL.connectLimb(toeL4, humanExtremity)
	footL.connectLimb(toeL5, humanExtremity)
	
	return brain

func _ready() -> void:
	print("\n==Starting Limb Test==\n")
	var humanBrain: Limb = constructHuman()
	
	completeBody(humanBrain, true)
	
	print("Hey")

