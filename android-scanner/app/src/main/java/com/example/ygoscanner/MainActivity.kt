package com.example.ygoscanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.Camera
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.File
import android.util.Base64
import java.util.concurrent.Executors
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var lastResultText: TextView
    private lateinit var serverInput: EditText
    private lateinit var connectButton: Button
    private lateinit var connectOverlay: FrameLayout
    private lateinit var connectionStatus: TextView
    private lateinit var scannerContainer: FrameLayout
    private lateinit var libraryContainer: android.widget.LinearLayout
    private lateinit var tabScanner: Button
    private lateinit var tabLibrary: Button
    private lateinit var libraryStatus: TextView
    private lateinit var libraryList: ListView
    private lateinit var scanButton: Button
    private lateinit var torchButton: Button

    private val cameraExecutor = Executors.newSingleThreadExecutor()
    private var webSocket: WebSocket? = null
    private var lastAnalysisAt = 0L
    private var cardPresenceHits = 0
    private val libraryItems = mutableListOf<CardRecord>()
    private lateinit var libraryAdapter: CardAdapter
    private var torchEnabled = false
    private var activeCamera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var lastCaptureAt = 0L
    private var isCapturing = false
    private val captureCooldownMs = 2500L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        previewView = findViewById(R.id.previewView)
        statusText = findViewById(R.id.statusText)
        lastResultText = findViewById(R.id.lastResultText)
        serverInput = findViewById(R.id.serverInput)
        connectButton = findViewById(R.id.connectButton)
        connectOverlay = findViewById(R.id.connectOverlay)
        connectionStatus = findViewById(R.id.connectionStatus)
        scannerContainer = findViewById(R.id.scannerContainer)
        libraryContainer = findViewById(R.id.libraryContainer)
        tabScanner = findViewById(R.id.tabScanner)
        tabLibrary = findViewById(R.id.tabLibrary)
        libraryStatus = findViewById(R.id.libraryStatus)
        libraryList = findViewById(R.id.libraryList)
        scanButton = findViewById(R.id.scanButton)
        torchButton = findViewById(R.id.torchButton)

        libraryAdapter = CardAdapter(this, libraryItems)
        libraryList.adapter = libraryAdapter

        tabScanner.setOnClickListener { showScanner() }
        tabLibrary.setOnClickListener { showLibrary() }
        loadCachedLibrary()
        loadSavedServerAddress()

        connectButton.setOnClickListener {
            if (hasCameraPermission()) {
                connectAndStart()
            } else {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), 1001)
            }
        }

        scanButton.setOnClickListener {
            statusText.text = "Status: Automatischer Scan aktiv (Karte im Rahmen)"
        }

        torchButton.setOnClickListener {
            torchEnabled = !torchEnabled
            torchButton.text = if (torchEnabled) "Licht an" else "Licht"
            activeCamera?.cameraControl?.enableTorch(torchEnabled)
        }
    }

    private fun connectAndStart() {
        val target = serverInput.text.toString().trim()
        if (target.isEmpty()) {
            statusText.text = "Status: Bitte PC IP:Port eingeben"
            return
        }
        val wsUrl = "ws://$target"
        saveServerAddress(target)
        val client = OkHttpClient()
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                statusText.post { statusText.text = "Status: Verbindung fehlgeschlagen" }
                connectionStatus.post { connectionStatus.text = "Connection failed" }
            }

            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                connectionStatus.post { connectionStatus.text = "Connected" }
                connectOverlay.post { connectOverlay.visibility = android.view.View.GONE }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerMessage(text)
            }
        })
        statusText.text = "Status: verbunden ($wsUrl)"
        connectionStatus.text = "Connecting..."
        requestSync()
        startCamera()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val capture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also { imageAnalysis ->
                    imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                        val now = System.currentTimeMillis()
                        if (now - lastAnalysisAt < 900) {
                            imageProxy.close()
                            return@setAnalyzer
                        }
                        lastAnalysisAt = now
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val cardPresent = detectCardPresence(imageProxy)
                            if (cardPresent) {
                                cardPresenceHits += 1
                                if (cardPresenceHits >= 2) {
                                    captureCardImage()
                                    statusText.post { statusText.text = "Status: Karte erkannt, Foto wird gemacht…" }
                                    cardPresenceHits = 0
                                } else {
                                    statusText.post { statusText.text = "Status: Karte erkannt, stabilisieren…" }
                                }
                            } else {
                                cardPresenceHits = 0
                                statusText.post { statusText.text = "Status: Suche Karte im Rahmen…" }
                            }
                        }
                        imageProxy.close()
                    }
                }

            cameraProvider.unbindAll()
            imageCapture = capture
            activeCamera = cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, capture)
        }, ContextCompat.getMainExecutor(this))
    }

    private fun detectCardPresence(imageProxy: ImageProxy): Boolean {
        val plane = imageProxy.planes.firstOrNull() ?: return false
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val width = imageProxy.width
        val height = imageProxy.height
        val data = ByteArray(buffer.remaining())
        buffer.get(data)

        val left = (width * 0.15f).toInt()
        val right = (width * 0.85f).toInt()
        val top = (height * 0.15f).toInt()
        val bottom = (height * 0.85f).toInt()
        val stepX = ((right - left) / 18).coerceAtLeast(1)
        val stepY = ((bottom - top) / 18).coerceAtLeast(1)

        var diffSum = 0L
        var count = 0L
        var y = top
        while (y < bottom - stepY) {
            var x = left
            while (x < right - stepX) {
                val index = y * rowStride + x * pixelStride
                val indexRight = y * rowStride + (x + stepX) * pixelStride
                val indexDown = (y + stepY) * rowStride + x * pixelStride
                val current = data.getOrNull(index)?.toInt()?.and(0xFF) ?: 0
                val rightValue = data.getOrNull(indexRight)?.toInt()?.and(0xFF) ?: current
                val downValue = data.getOrNull(indexDown)?.toInt()?.and(0xFF) ?: current
                diffSum += kotlin.math.abs(current - rightValue) + kotlin.math.abs(current - downValue)
                count += 2
                x += stepX
            }
            y += stepY
        }

        if (count == 0L) return false
        val avgDiff = diffSum / count.toFloat()
        return avgDiff > 12f
    }

    private fun captureCardImage() {
        val capture = imageCapture ?: return
        val now = System.currentTimeMillis()
        if (isCapturing || now - lastCaptureAt < captureCooldownMs) return
        isCapturing = true
        lastCaptureAt = now
        statusText.post { statusText.text = "Status: Foto wird gesendet…" }

        val photoFile = File(cacheDir, "scan_$now.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()
        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                    try {
                        val bytes = photoFile.readBytes()
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        sendScanImage(base64)
                    } catch (_: Exception) {
                        statusText.post { statusText.text = "Status: Bild konnte nicht gesendet werden" }
                    } finally {
                        photoFile.delete()
                        isCapturing = false
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    statusText.post { statusText.text = "Status: Foto fehlgeschlagen" }
                    isCapturing = false
                }
            }
        )
    }

    private fun sendScanImage(base64: String) {
        val obj = JSONObject()
        obj.put("type", "scanImage")
        obj.put("image", base64)
        webSocket?.send(obj.toString())
    }

    private fun requestSync() {
        val obj = JSONObject()
        obj.put("type", "sync")
        webSocket?.send(obj.toString())
    }

    private fun handleServerMessage(text: String) {
        try {
            val payload = JSONObject(text)
            when (payload.optString("type")) {
                "scanAck" -> {
                    statusText.post { statusText.text = "Status: Bild übertragen, Analyse läuft…" }
                }
                "scanResult" -> {
                    val card = payload.optJSONObject("card") ?: return
                    val deName = card.optString("de_name")
                    val enName = card.optString("en_name")
                    val passcode = card.optString("passcode")
                    lastResultText.post {
                        lastResultText.text = "Letzter Scan: $passcode\nDE: $deName\nEN: $enName"
                    }
                    statusText.post { statusText.text = "Status: Karte erfasst" }
                }
                "sync" -> {
                    val cards = payload.optJSONArray("cards") ?: JSONArray()
                    updateLibrary(cards)
                }
            }
        } catch (_: Exception) {
            // ignore
        }
    }

    private fun updateLibrary(cards: JSONArray) {
        libraryItems.clear()
        for (i in 0 until cards.length()) {
            val item = cards.optJSONObject(i) ?: continue
            libraryItems.add(
                CardRecord(
                    id = item.optInt("id"),
                    deName = item.optString("de_name"),
                    enName = item.optString("en_name"),
                    passcode = item.optString("passcode"),
                    imageUrl = item.optString("source_url")
                )
            )
        }
        cacheLibrary(cards)
        libraryStatus.post { libraryStatus.text = "Geladene Karten: ${libraryItems.size}" }
        runOnUiThread { libraryAdapter.notifyDataSetChanged() }
    }

    private fun cacheLibrary(cards: JSONArray) {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        prefs.edit().putString("cards", cards.toString()).apply()
    }

    private fun loadCachedLibrary() {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        val raw = prefs.getString("cards", null) ?: return
        try {
            val cards = JSONArray(raw)
            updateLibrary(cards)
        } catch (_: Exception) {
        }
    }

    private fun showScanner() {
        scannerContainer.visibility = android.view.View.VISIBLE
        libraryContainer.visibility = android.view.View.GONE
    }

    private fun showLibrary() {
        scannerContainer.visibility = android.view.View.GONE
        libraryContainer.visibility = android.view.View.VISIBLE
        requestSync()
    }

    private fun saveServerAddress(value: String) {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        prefs.edit().putString("server_address", value).apply()
    }

    private fun loadSavedServerAddress() {
        val prefs = getSharedPreferences("scanner_cache", MODE_PRIVATE)
        val saved = prefs.getString("server_address", "") ?: ""
        if (saved.isNotBlank()) {
            serverInput.setText(saved)
        }
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }
}

data class CardRecord(
    val id: Int,
    val deName: String,
    val enName: String,
    val passcode: String,
    val imageUrl: String
)

class CardAdapter(
    private val context: android.content.Context,
    private val items: List<CardRecord>
) : android.widget.BaseAdapter() {
    override fun getCount(): Int = items.size
    override fun getItem(position: Int): Any = items[position]
    override fun getItemId(position: Int): Long = items[position].id.toLong()

    override fun getView(position: Int, convertView: android.view.View?, parent: android.view.ViewGroup): android.view.View {
        val view = convertView ?: android.view.LayoutInflater.from(context).inflate(R.layout.item_card, parent, false)
        val record = items[position]
        val title = view.findViewById<TextView>(R.id.cardTitle)
        val subtitle = view.findViewById<TextView>(R.id.cardSubtitle)
        val passcode = view.findViewById<TextView>(R.id.cardPasscode)
        val image = view.findViewById<ImageView>(R.id.cardImage)

        title.text = record.enName.ifBlank { record.deName }
        subtitle.text = "DE: ${record.deName} / EN: ${record.enName}"
        passcode.text = "Passcode: ${record.passcode}"
        if (record.imageUrl.isNotBlank()) {
            loadImage(record.imageUrl, image)
        }
        return view
    }

    private fun loadImage(url: String, imageView: ImageView) {
        thread {
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 5000
                connection.readTimeout = 5000
                connection.doInput = true
                connection.connect()
                val bitmap = android.graphics.BitmapFactory.decodeStream(connection.inputStream)
                imageView.post { imageView.setImageBitmap(bitmap) }
            } catch (_: Exception) {
            }
        }
    }
}
