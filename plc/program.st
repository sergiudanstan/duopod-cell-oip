(* DuoPod transfer cell: one carton at a time from infeed A to outfeed B.

   Escapement (column clear):
     A1 accumulates the queue against the blade (BladeUp). A2, the pick belt, runs faster (0.6 vs 0.4 m/s).
     The blade drops only when the pick lane on A2 is empty (EyeGate, EyeZone, EyeStop clear) AND the robot is clear
     of the infeed column (TCP over belt B or above 250 mm). The released carton accelerates on A2 and opens a gap to
     the next one; EyeHead (20 mm upstream of the blade) sees that gap, A1 stops at once, the blade rises in the gap,
     and A1 runs again once the blade is up. The carton runs on to the fixed end stop under the robot.
   Robot (DuoPod part handshake: RobotCmd row, rising RobotExecute, RobotDone/RobotPoint):
     ready (1) -> wait carton settled at the stop -> pick (2) -> vacuum, wait VacuumOk ->
     wait the belt-B drop zone clear (EyeB0, EyeB1) -> place (3) -> vacuum off, wait release -> ready (1).
   Supervision: ColumnAlarm latches if the blade is ever open while the TCP is low over the infeed column (the
   interlock above failed); it stops the line like an E-stop and START clears it.
   Safety: the E-stop contact (EStopOk, normally closed) drops RobotEnable (the robot holds where it is, vacuum kept so the carton is not dropped), stops every
   belt and the feed, and latches Running off; START restarts. Stack light: green running, amber stopped, red E-stop. *)
VAR_INPUT
        StartPB : BOOL;
        EStopOk : BOOL;
        EyeStop : BOOL;
        EyeZone : BOOL;
        EyeGate : BOOL;
        EyeHead : BOOL;
        EyeFull : BOOL;
        EyeB0 : BOOL;
        EyeB1 : BOOL;
        RobotDone : BOOL;
        RobotBusy : BOOL;
        RobotPoint : INT;
        VacuumOk : BOOL;
        RobotX : REAL;
        RobotZ : REAL;
        Delivered : INT;
END_VAR
VAR_OUTPUT
        BeltA1Run : BOOL;
        BeltA2Run : BOOL;
        BeltBRun : BOOL;
        FeedRun : BOOL;
        BladeUp : BOOL := TRUE;
        RobotCmd : INT;
        RobotExecute : BOOL;
        Vacuum : BOOL;
        RobotEnable : BOOL;
        StackLight : INT;
        Running : BOOL;
        Releasing : BOOL;
        Step : INT;
        Picked : INT;
        ColumnAlarm : BOOL;
END_VAR
VAR
        A1Hold : BOOL;
        LaneEmpty : BOOL;
        RobotClear : BOOL;
        DropClear : BOOL;
        Settled : TON;
        BladeDelay : TON;
        BladeRise : TON;
        VacWait : TON;
        QueueFull : TON;
        Moving : BOOL;
END_VAR

(* ---------------------------------------------------------------- run / safety *)
IF StartPB THEN ColumnAlarm := FALSE; END_IF;
Running := (Running OR StartPB) AND EStopOk AND NOT ColumnAlarm;
(* motion only while latched running: releasing the E-stop alone must not restart the robot (ISO 13850), START does *)
RobotEnable := Running;
BeltA2Run := Running;
BeltBRun := Running;
(* queue full = a carton standing at EyeFull, not one passing it after the drop *)
QueueFull(IN := EyeFull, PT := T#1s);
FeedRun := Running AND NOT QueueFull.Q;
IF NOT EStopOk THEN
        StackLight := 4;
ELSIF Running THEN
        StackLight := 1;
ELSE
        StackLight := 2;
END_IF;

(* ---------------------------------------------------------------- escapement *)
LaneEmpty := NOT EyeGate AND NOT EyeZone AND NOT EyeStop;
RobotClear := (RobotX < 100.0) OR (RobotZ > 250.0);
IF Running AND BladeUp AND NOT A1Hold AND LaneEmpty AND RobotClear AND EyeHead THEN
        BladeUp := FALSE;
        Releasing := TRUE;
END_IF;
(* the gap reaches the head eye: hold A1, the next carton stops short of the blade *)
IF Releasing AND NOT EyeHead THEN
        A1Hold := TRUE;
        Releasing := FALSE;
END_IF;
(* the released carton's tail clears the blade line ~35 ms after the eye clears *)
BladeDelay(IN := A1Hold AND NOT BladeUp, PT := T#120ms);
IF BladeDelay.Q THEN
        BladeUp := TRUE;
END_IF;
BladeRise(IN := A1Hold AND BladeUp, PT := T#400ms);
IF BladeRise.Q THEN
        A1Hold := FALSE;
END_IF;
BeltA1Run := Running AND NOT A1Hold;
(* supervision: the blade open with the robot low over the infeed column *)
IF NOT BladeUp AND RobotX >= 100.0 AND RobotZ <= 250.0 THEN
        ColumnAlarm := TRUE;
END_IF;

(* ---------------------------------------------------------------- robot cycle *)
DropClear := NOT EyeB0 AND NOT EyeB1;
(* a carton at the stop spans z -0.12..0.13 and covers EyeZone too; one carton is released at a time *)
Settled(IN := EyeStop, PT := T#300ms);
VacWait(IN := (Step = 30) OR (Step = 50), PT := T#150ms);
CASE Step OF
        0:      (* idle: go to ready once running *)
                Vacuum := FALSE;
                IF Running AND RobotDone THEN
                        RobotCmd := 1; Moving := TRUE; Step := 10;
                END_IF;
        10:     (* to ready *)
                IF Moving AND RobotBusy THEN Moving := FALSE; END_IF;
                IF NOT Moving AND RobotDone AND RobotPoint = 1 THEN Step := 20; END_IF;
        20:     (* wait for a settled carton at the stop *)
                IF Running AND Settled.Q THEN
                        RobotCmd := 2; Moving := TRUE; Step := 25;
                END_IF;
        25:     (* down to pick *)
                IF Moving AND RobotBusy THEN Moving := FALSE; END_IF;
                IF NOT Moving AND RobotDone AND RobotPoint = 2 THEN Vacuum := TRUE; Step := 30; END_IF;
        30:     (* grip *)
                IF VacuumOk AND VacWait.Q THEN Step := 40; END_IF;
        40:     (* wait for the drop zone on belt B *)
                IF Running AND DropClear THEN
                        RobotCmd := 3; Moving := TRUE; Step := 45;
                END_IF;
        45:     (* transfer *)
                IF Moving AND RobotBusy THEN Moving := FALSE; END_IF;
                IF NOT Moving AND RobotDone AND RobotPoint = 3 THEN Vacuum := FALSE; Step := 50; END_IF;
        50:     (* release *)
                IF NOT VacuumOk AND VacWait.Q THEN
                        Picked := Picked + 1;
                        RobotCmd := 1; Moving := TRUE; Step := 10;
                END_IF;
END_CASE;
(* Execute is held from the command until the robot answers Busy: a one-scan pulse can fall between two part ticks *)
RobotExecute := Moving;
